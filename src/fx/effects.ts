/**
 * Effects — pooled sparks for pickups, deaths, crumbles and portal bursts, plus voxel halos.
 *
 * Purpose
 *   Short-lived particles drawn as one additive Points layer, so any number of bursts cost a
 *   single draw call.
 *
 * Operations
 *   - new Effects(scene, max): allocates the pool (position, colour) and a soft dot texture.
 *   - burst(x, y, color, count, speed, gravity): adds sparks at a world point; a full pool
 *     overwrites random slots.
 *   - update(dt): integrates, fades by remaining life, and compacts live sparks to the front so
 *     the draw range is exactly the live set.
 *   - halo(x, y, color): a blocky crystal-pickup halo: two rings of glowing cubes snapped to
 *     the 1/8 voxel grid (so they read as pixel-art circles) burst outward, shrinking and
 *     spinning as they fade, with a flash of coloured light. One InstancedMesh, HALOS at once.
 *   - motes(kind, color, count): the cavern's ambient particles (dust drifting, spores and
 *     bubbles rising, embers flickering up, drips falling, glints twinkling), wrapped inside
 *     the cavern. One more additive Points layer; count comes from the tier's particle budget.
 *   - clear(): drops every spark and halo (cavern change).
 *
 * Highlights
 *   - No allocation per frame: buffers are written element-wise.
 *   - Colours are HDR (above 1), so sparks cross the bloom threshold.
 *
 * See also: render/view.ts (owner), main.ts (event → burst); DESIGN.md "9. Rendering".
 */
import * as THREE from "three";
import type { MoteKind } from "../core/palette";

/** Per mote kind: speed range (world units/s, + is up), sideways wobble, brightness. */
const MOTE: Record<MoteKind, { vy: [number, number]; vx: number; wobble: number; k: number }> = {
    dust: { vy: [-0.03, 0.03], vx: 0.18, wobble: 0.1, k: 0.35 },
    spores: { vy: [0.12, 0.3], vx: 0.03, wobble: 0.25, k: 1.3 },
    embers: { vy: [0.6, 1.2], vx: 0.1, wobble: 0.35, k: 1.8 },
    drips: { vy: [-4.5, -3], vx: 0, wobble: 0, k: 0.7 },
    bubbles: { vy: [0.35, 0.7], vx: 0.02, wobble: 0.2, k: 0.6 },
    glints: { vy: [-0.02, 0.02], vx: 0.02, wobble: 0.05, k: 1.5 },
};
/** Cavern interior bounds for wrapping motes (inside the border rock). */
const MX0 = 1,
    MX1 = 31,
    MY0 = 1,
    MY1 = 15;

/** Halos alive at once, cubes per halo (both rings), and seconds each lasts. */
const HALOS = 4;
const HALO_CUBES = 24;
const HALO_LIFE = 0.6;
const MOTE_CAP = 120;
/** [cubes, start delay (s), reach (world units)] per ring. */
const RINGS: [number, number, number][] = [
    [16, 0, 1.5],
    [8, 0.08, 0.9],
];
const AXIS = new THREE.Vector3(0.3, 0.5, 1).normalize();
const V = new THREE.Vector3(),
    S = new THREE.Vector3();

export class Effects {
    private pos: Float32Array;
    private col: Float32Array;
    private vel: Float32Array;
    private life: Float32Array;
    private max: Float32Array;
    private grav: Float32Array;
    private base: Float32Array;
    private n = 0;
    private geo = new THREE.BufferGeometry();
    readonly points: THREE.Points;
    private halos: { x: number; y: number; color: THREE.Color; age: number }[] = [];
    private cubes = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        HALOS * HALO_CUBES
    );
    /** Lights the walls around a pickup; always in the scene so shaders never recompile. */
    private flash = new THREE.PointLight(0xffffff, 0, 6, 1.5);
    private m4 = new THREE.Matrix4();
    private moteKind: MoteKind = "dust";
    private moteN = 0;
    private moteBase = new THREE.Color();
    private motePos = new Float32Array(MOTE_CAP * 3);
    private moteCol = new Float32Array(MOTE_CAP * 3);
    /** Per mote: vx, vy, phase. */
    private moteVel = new Float32Array(MOTE_CAP * 3);
    private moteGeo = new THREE.BufferGeometry();
    private time = 0;
    private q = new THREE.Quaternion();
    private c = new THREE.Color();

    constructor(
        scene: THREE.Scene,
        private cap: number
    ) {
        this.pos = new Float32Array(cap * 3);
        this.col = new Float32Array(cap * 3);
        this.base = new Float32Array(cap * 3);
        this.vel = new Float32Array(cap * 2);
        this.life = new Float32Array(cap);
        this.max = new Float32Array(cap);
        this.grav = new Float32Array(cap);
        this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
        this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
        this.geo.setDrawRange(0, 0);
        this.points = new THREE.Points(
            this.geo,
            new THREE.PointsMaterial({
                size: 0.28,
                map: dotTexture(),
                vertexColors: true,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                toneMapped: false,
            })
        );
        this.points.frustumCulled = false;
        this.cubes.frustumCulled = false;
        this.cubes.count = 0;
        this.cubes.setColorAt(0, this.c.set(0)); // allocate instanceColor before the warm-up compile
        this.moteGeo.setAttribute("position", new THREE.BufferAttribute(this.motePos, 3));
        this.moteGeo.setAttribute("color", new THREE.BufferAttribute(this.moteCol, 3));
        this.moteGeo.setDrawRange(0, 0);
        const moteLayer = new THREE.Points(this.moteGeo, (this.points.material as THREE.PointsMaterial).clone());
        (moteLayer.material as THREE.PointsMaterial).size = 0.12;
        moteLayer.frustumCulled = false;
        scene.add(this.points, this.cubes, this.flash, moteLayer);
    }

    motes(kind: MoteKind, color: number, count: number) {
        const m = MOTE[kind];
        this.moteKind = kind;
        this.moteN = Math.min(MOTE_CAP, count);
        this.moteBase.setHex(color).multiplyScalar(m.k);
        for (let i = 0; i < this.moteN; i++) {
            this.motePos.set(
                [MX0 + Math.random() * (MX1 - MX0), MY0 + Math.random() * (MY1 - MY0), -0.5 + Math.random() * 1.2],
                i * 3
            );
            this.moteVel.set(
                [(Math.random() - 0.5) * 2 * m.vx, m.vy[0] + Math.random() * (m.vy[1] - m.vy[0]), Math.random() * 6.3],
                i * 3
            );
        }
        this.moteGeo.setDrawRange(0, this.moteN);
    }

    halo(x: number, y: number, color: THREE.Color) {
        if (this.halos.length >= HALOS) this.halos.shift();
        this.halos.push({ x, y, color: color.clone(), age: 0 });
    }

    burst(x: number, y: number, color: THREE.Color, count: number, speed = 4, gravity = 6) {
        for (let k = 0; k < count; k++) {
            const i = this.n < this.cap ? this.n++ : Math.floor(Math.random() * this.cap);
            const a = Math.random() * Math.PI * 2;
            const s = speed * (0.3 + Math.random() * 0.7);
            this.pos.set([x, y, 0.6], i * 3);
            this.vel[i * 2] = Math.cos(a) * s;
            this.vel[i * 2 + 1] = Math.sin(a) * s + speed * 0.3;
            this.life[i] = this.max[i] = 0.4 + Math.random() * 0.6;
            this.grav[i] = gravity;
            this.base.set([color.r, color.g, color.b], i * 3);
        }
    }

    update(dt: number) {
        let w = 0;
        for (let i = 0; i < this.n; i++) {
            const l = this.life[i] - dt;
            if (l <= 0) continue;
            this.vel[i * 2 + 1] -= this.grav[i] * dt;
            const k = l / this.max[i];
            this.pos[w * 3] = this.pos[i * 3] + this.vel[i * 2] * dt;
            this.pos[w * 3 + 1] = this.pos[i * 3 + 1] + this.vel[i * 2 + 1] * dt;
            this.pos[w * 3 + 2] = this.pos[i * 3 + 2];
            this.vel[w * 2] = this.vel[i * 2];
            this.vel[w * 2 + 1] = this.vel[i * 2 + 1];
            for (let c = 0; c < 3; c++) {
                this.base[w * 3 + c] = this.base[i * 3 + c];
                this.col[w * 3 + c] = this.base[i * 3 + c] * k;
            }
            this.life[w] = l;
            this.max[w] = this.max[i];
            this.grav[w] = this.grav[i];
            w++;
        }
        this.n = w;
        this.geo.setDrawRange(0, w);
        (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
        this.updateHalos(dt);
        this.updateMotes(dt);
    }

    private updateMotes(dt: number) {
        this.time += dt;
        const m = MOTE[this.moteKind],
            t = this.time,
            p = this.motePos,
            v = this.moteVel,
            c = this.moteCol,
            b = this.moteBase;
        for (let i = 0; i < this.moteN; i++) {
            const ph = v[i * 3 + 2];
            p[i * 3] += (v[i * 3] + Math.sin(t * 1.3 + ph) * m.wobble) * dt;
            p[i * 3 + 1] += v[i * 3 + 1] * dt;
            if (p[i * 3] < MX0) p[i * 3] += MX1 - MX0;
            if (p[i * 3] > MX1) p[i * 3] -= MX1 - MX0;
            if (p[i * 3 + 1] < MY0) p[i * 3 + 1] = MY1;
            if (p[i * 3 + 1] > MY1) p[i * 3 + 1] = MY0;
            // Glints twinkle and embers flicker; the rest hold a gentle shimmer.
            const f =
                this.moteKind === "glints"
                    ? Math.max(0, Math.sin(t * 2.5 + ph * 3)) ** 3
                    : this.moteKind === "embers"
                      ? 0.6 + 0.4 * Math.sin(t * 13 + ph * 5)
                      : 0.8 + 0.2 * Math.sin(t * 2 + ph);
            c[i * 3] = b.r * f;
            c[i * 3 + 1] = b.g * f;
            c[i * 3 + 2] = b.b * f;
        }
        (this.moteGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (this.moteGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }

    private updateHalos(dt: number) {
        this.halos = this.halos.filter((h) => (h.age += dt) < HALO_LIFE);
        const snap = (v: number) => Math.round(v * 8) / 8;
        let n = 0;
        for (const h of this.halos) {
            // Outer ring of 16, then an inner ring of 8 a beat later.
            for (const [count, delay, reach] of RINGS) {
                const k = (h.age - delay) / (HALO_LIFE - delay);
                if (k <= 0) continue;
                const ease = 1 - (1 - k) ** 3;
                const r = 0.65 + reach * ease;
                const size = 0.2 * (1 - k * 0.6);
                this.q.setFromAxisAngle(AXIS, k * 4);
                const fade = (1 - k) ** 1.5;
                for (let i = 0; i < count; i++) {
                    const a = (i / count) * Math.PI * 2 + delay * 3;
                    this.m4.compose(
                        V.set(snap(h.x + Math.cos(a) * r), snap(h.y + Math.sin(a) * r), 0.7),
                        this.q,
                        S.setScalar(size)
                    );
                    this.cubes.setMatrixAt(n, this.m4);
                    this.cubes.setColorAt(n++, this.c.copy(h.color).multiplyScalar(fade));
                }
            }
        }
        this.cubes.count = n;
        this.cubes.instanceMatrix.needsUpdate = true;
        if (this.cubes.instanceColor) this.cubes.instanceColor.needsUpdate = true;
        // The newest halo drives the flash.
        const h = this.halos[this.halos.length - 1];
        this.flash.intensity = h ? 6 * (1 - h.age / HALO_LIFE) ** 2 : 0;
        if (h) (this.flash.position.set(h.x, h.y, 1.2), this.flash.color.copy(h.color).multiplyScalar(0.5));
    }

    clear() {
        this.n = 0;
        this.geo.setDrawRange(0, 0);
        this.halos = [];
        this.cubes.count = 0;
        this.flash.intensity = 0;
    }
}

function dotTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.6)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
}
