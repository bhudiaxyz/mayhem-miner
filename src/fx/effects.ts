/**
 * Effects — a pooled spark system for crystal pickups, deaths, crumbles and portal bursts.
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
 *   - clear(): drops every spark (cavern change).
 *
 * Highlights
 *   - No allocation per frame: buffers are written element-wise.
 *   - Colours are HDR (above 1), so sparks cross the bloom threshold.
 *
 * See also: render/view.ts (owner), main.ts (event → burst); DESIGN.md "9. Rendering".
 */
import * as THREE from "three";

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
        scene.add(this.points);
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
    }

    clear() {
        this.n = 0;
        this.geo.setDrawRange(0, 0);
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
