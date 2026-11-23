/**
 * View — the three.js scene: voxel cavern, miner, guardians, crystals, portal, lights, post-FX.
 *
 * Purpose
 *   Draws a Game every frame. Reads game state, never writes it. The cavern is a shallow 3D
 *   diorama of chunky blocks in front of a copper-bar backdrop, seen by a fixed camera.
 *
 * Operations
 *   - new View(host, tier): renderer (ACES tone mapping, sRGB), a fixed perspective camera
 *     framed to the 32 × 16 cavern plus HUD margins, hemisphere + key light (+ shadows on high
 *     tiers), the miner's helmet lamp, shared pixel-art textures, and the composer
 *     (RenderPass → UnrealBloomPass → OutputPass) on a HalfFloat multisampled target.
 *   - build(cavern): disposes the previous cavern's group and builds this one:
 *       rock (#), ledges (=), crumbling ledges (~), conveyors (< >), doors (D) as InstancedMeshes;
 *       glowing edge strips on every air-facing top; spikes; levers; crystals; the portal;
 *       guardian models; and the backdrop canvas.
 *   - sync(game, dt): rebuilds when game.cavern changes identity, then poses everything:
 *     crumble wear (ledges sink and shrink), doors, crystals (colour cycling = flashing,
 *     hidden once taken), lever, portal (dark until open, then pulsing), guardians and the
 *     miner, both interpolated between 40 Hz ticks by game.alpha, then renders.
 *   - warmup(): compileAsync over the whole scene plus one composer render, at boot.
 *   - burst(px, py, color, n): sparks at a game-pixel position (main.ts, on events).
 *   - resize(): on window resize; reframes the camera.
 *
 * Usage
 *   main.ts: const view = new View(app, TIER_SETTINGS[tier]); view.sync(game, dt) each frame.
 *
 * Highlights
 *   - Game px → world: x / 8 and 16 − y / 8 (y flips: the game counts rows downward).
 *   - Neon materials use toneMapped: false with HDR colours, so they alone cross the bloom
 *     threshold: crystals, edge strips, the open portal, lamp, guardian eyes, sparks.
 *   - Textures are painted at runtime into tiny canvases with nearest filtering: no image files.
 *   - A restart (death) keeps the same cavern object, so nothing is rebuilt; per-frame state
 *     (wear, doors, crystals) is all read from the Game.
 *
 * See also: core/game.ts, core/palette.ts, fx/effects.ts, render/tier.ts; DESIGN.md "9. Rendering".
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CRUMBLE_TICKS, DEAD_PAUSE, type Game } from "../core/game";
import { FALL_LIMIT, TICK } from "../core/physics";
import { COLORS, hdr, themeFor, type Theme } from "../core/palette";
import { rng } from "../core/random";
import { H, W, type Cavern, type Guardian } from "../world/caverns";
import { Effects } from "../fx/effects";
import type { TierSettings } from "./tier";

const DEPTH = 1.2; // block depth (z)
/** Miner, guardians and crystals are drawn at 75% of their 1 × 2 cell box, from the feet. */
const SPRITE = 0.75;
const FOV = 30;
/** Seconds the miner tumbles (hops, spins, shrinks) after a death before vanishing. */
const TUMBLE = 0.8;
/** How far (world units) the camera drifts toward the miner, for parallax. */
const DRIFT_X = 0.4,
    DRIFT_Y = 0.25;
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Facing angles: a turn eases from one to the other through facing the camera. */
const FACE_R = -0.45,
    FACE_L = -Math.PI + 0.45;

type Pose = (t: number, moving: number) => void;

export class View {
    readonly renderer: THREE.WebGLRenderer;
    private scene = new THREE.Scene();
    private camera = new THREE.PerspectiveCamera(FOV, 1, 1, 400);
    private composer: EffectComposer;
    private effects: Effects;
    private lamp = new THREE.PointLight(COLORS.lampLight, 9, 9, 1.6);
    private key = new THREE.DirectionalLight(0xffffff, 1.6);
    /** Lights the cavern around the portal once it opens (dark while closed). */
    private portalLight = new THREE.PointLight(0xffffff, 0, 7, 1.6);
    private camBase = new THREE.Vector3();
    private camLook = new THREE.Vector3();
    private camDrift = new THREE.Vector3();
    private level = new THREE.Group();
    private built: Cavern | null = null;
    private tex = textures();
    // Per-cavern handles, set by build().
    private crumble!: THREE.InstancedMesh;
    private crumbleCells: number[] = [];
    private doors!: THREE.Group;
    private crystals: THREE.Mesh[] = [];
    private levers: THREE.Group[] = [];
    private portal!: { group: THREE.Group; frame: THREE.MeshBasicMaterial; core: THREE.MeshBasicMaterial };
    private guardians: { group: THREE.Group; pose: Pose }[] = [];
    private miner: { group: THREE.Group; pose: Pose };
    private belts: THREE.Texture[] = [];
    private theme!: Theme;
    private m4 = new THREE.Matrix4();
    private v3 = new THREE.Vector3();

    constructor(
        host: HTMLElement,
        private ts: TierSettings
    ) {
        this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, ts.dprCap));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.renderer.shadowMap.enabled = ts.shadowMap > 0;
        host.append(this.renderer.domElement);

        this.scene.background = new THREE.Color(COLORS.ui.bg);
        this.scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x40302a, 1.5));
        this.key.position.set(10, 24, 22);
        this.key.target.position.set(16, 8, 0);
        if (ts.shadowMap) {
            this.key.castShadow = true;
            this.key.shadow.mapSize.set(ts.shadowMap, ts.shadowMap);
            const c = this.key.shadow.camera;
            c.left = c.bottom = -20;
            c.right = c.top = 20;
            c.near = 5;
            c.far = 70;
            this.key.shadow.bias = -0.0005;
            this.key.shadow.normalBias = 0.03;
        }
        this.scene.add(this.key, this.key.target, this.lamp, this.portalLight, this.level);
        this.miner = minerModel();
        this.scene.add(this.miner.group);
        this.effects = new Effects(this.scene, ts.particles);

        const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: ts.msaa });
        this.composer = new EffectComposer(this.renderer, target);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        if (ts.ao) {
            const ao = new GTAOPass(this.scene, this.camera, 1, 1);
            ao.updateGtaoMaterial({ radius: 0.6, thickness: 1 });
            ao.blendIntensity = 0.8;
            this.composer.addPass(ao);
        }
        if (ts.bloom) this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.4, 0.85));
        this.composer.addPass(new OutputPass());
        this.resize();
        // The host's size is set by CSS (on portrait phones it leaves room for the controls).
        new ResizeObserver(() => this.resize()).observe(host);
    }

    resize() {
        const host = this.renderer.domElement.parentElement!;
        const w = Math.max(1, host.clientWidth),
            h = Math.max(1, host.clientHeight);
        this.renderer.setSize(w, h);
        this.composer.setPixelRatio(this.renderer.getPixelRatio());
        this.composer.setSize(w, h);
        const aspect = w / h;
        this.camera.aspect = aspect;
        // Frame the cavern plus room for the HUD bars above and below.
        const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
        const needH = H + 3.6,
            needW = W + 1;
        const dist = Math.max(needH / 2 / tan, needW / 2 / (tan * aspect));
        this.camBase.set(W / 2, H / 2 + dist * 0.06, dist);
        this.camLook.set(W / 2, H / 2 - 0.1, 0);
        this.camera.position.copy(this.camBase).add(this.camDrift);
        this.camera.lookAt(this.camLook);
        this.camera.updateProjectionMatrix();
    }

    /**
     * Compile every shader in the scene, and render once through the composer, before play, so
     * the first frames (and the first spark burst) don't stall on a compile. The spark layer is
     * empty at boot, so it gets one invisible spark for the compile.
     */
    async warmup() {
        this.effects.burst(W / 2, H / 2, new THREE.Color(0, 0, 0), 1, 0);
        await this.renderer.compileAsync(this.scene, this.camera);
        this.composer.render();
        this.effects.clear();
    }

    burst(px: number, py: number, color: number, n: number, speed = 4, gravity?: number) {
        this.effects.burst(px / 8, H - py / 8, hdr(color, 2.2), n, speed, gravity);
    }

    sync(g: Game, dt: number) {
        if (g.cavern !== this.built) this.build(g.cavern, g.n);
        const t = g.time;
        const a = Math.min(1, g.alpha);

        // Crumbling ledges: sink and thin with wear; gone once the tile is air.
        this.crumbleCells.forEach((i, k) => {
            const c = i % W,
                r = Math.floor(i / W);
            const w = g.tiles[i] === "~" ? g.wear[i] / CRUMBLE_TICKS : 1;
            const s = w >= 1 ? 0 : 1 - 0.8 * w;
            const shake = w > 0 && w < 1 ? (Math.random() - 0.5) * 0.06 : 0;
            this.m4.makeScale(1, s, 1).setPosition(c + 0.5 + shake, H - r - 0.16 - w * 0.25, 0);
            this.crumble.setMatrixAt(k, this.m4);
        });
        if (this.crumbleCells.length) this.crumble.instanceMatrix.needsUpdate = true;
        this.doors.visible = !g.doorsOpen;
        for (const b of this.belts) b.offset.x -= (b.userData.dir as number) * dt * 1.2;

        this.crystals.forEach((m, i) => {
            m.visible = !g.got[i];
            if (!m.visible) return;
            m.rotation.y = t * 2 + i;
            m.position.y = (m.userData.y as number) + Math.sin(t * 3 + i) * 0.06;
            const cyc = COLORS.crystalCycle;
            (m.material as THREE.MeshBasicMaterial).color.copy(hdr(cyc[(Math.floor(t * 8) + i) % cyc.length], 2.4));
        });
        for (const l of this.levers) l.children[1].rotation.z = g.doorsOpen ? -0.6 : 0.6;
        const p = this.portal;
        if (g.open) {
            const k = 0.5 + 0.5 * Math.sin(t * 10);
            p.frame.color.copy(hdr(this.theme.glow, 1.6 + k));
            p.core.color.copy(hdr(COLORS.crystalCycle[Math.floor(t * 6) % 5], 0.6 + 0.8 * k));
            this.portalLight.intensity = 5 + 3 * k;
        } else {
            p.frame.color.setHex(COLORS.portalClosed);
            p.core.color.setHex(0x0a0810);
            this.portalLight.intensity = 0;
        }

        // Turns ease through facing the camera instead of snapping (frozen while paused: dt = 0).
        const turn = 1 - Math.exp(-dt * 14);
        g.guardians.forEach((gd, i) => {
            const v = this.guardians[i];
            const x = lerp(gd.px, gd.x, a),
                y = lerp(gd.py, gd.y, a);
            v.group.position.set(x / 8 + 0.5, H - y / 8 - 2, 0);
            if (gd.kind !== "lift") v.group.rotation.y += ((gd.dir > 0 ? FACE_R : FACE_L) - v.group.rotation.y) * turn;
            v.pose(t, 1);
        });

        const m = g.miner;
        const mg = this.miner.group;
        // Seconds since a death (the miner tumbles for TUMBLE of the DEAD_PAUSE).
        const since = g.phase === "dead" ? DEAD_PAUSE - g.timer + a * TICK : Infinity;
        const show = !g.demo && (g.phase === "play" || (g.phase === "complete" && g.air > 0) || since < TUMBLE);
        mg.visible = show;
        // Already falling too far to survive: flail and blink the lamp red.
        const doomed = g.phase === "play" && m.mode !== "ground" && m.y - m.apex > FALL_LIMIT;
        let x = W / 2,
            y = H / 2;
        if (show) {
            x = lerp(m.px, m.x, a) / 8 + 0.5;
            y = H - lerp(m.py, m.y, a) / 8 - 2;
            let s = g.phase === "complete" ? Math.max(0.05, g.air / g.cavern.air) : 1;
            mg.rotation.y += ((m.face > 0 ? FACE_R : FACE_L) - mg.rotation.y) * turn;
            mg.rotation.z = 0;
            let lamp = 9;
            if (since < TUMBLE) {
                const k = since / TUMBLE;
                y += since * 3 - since * since * 8;
                s = 1 - k;
                mg.rotation.z = -m.face * since * 9;
                lamp *= 1 - k;
            }
            mg.position.set(x, y, 0);
            mg.scale.setScalar(s * SPRITE);
            // Legs follow distance walked, interpolated to the drawn position (not 40 Hz steps).
            const walk = m.walk - Math.abs(m.x - m.px) * (1 - a);
            if (doomed || since < TUMBLE) this.miner.pose(t * 28, 1);
            else this.miner.pose(m.mode === "ground" ? walk * 0.35 : -1, m.mode === "ground" ? 1 : 0);
            // Low air: the lamp dims and (motion allowing) gutters.
            const f = g.air / g.cavern.air;
            if (g.phase === "play" && f < 0.2)
                lamp *= (0.45 + 2.75 * f) * (REDUCED_MOTION ? 1 : 0.75 + 0.25 * Math.sin(t * 31) * Math.sin(t * 7.7));
            this.lamp.position.set(x + m.face * 0.3, y + 1.9 * SPRITE, 1.4);
            this.lamp.intensity = lamp;
        } else this.lamp.intensity = g.demo ? 0 : this.lamp.intensity * 0.9;
        this.lamp.color.setHex(doomed && Math.floor(t * 12) % 2 ? COLORS.lampDanger : COLORS.lampLight);

        // Camera drifts a little toward the miner so the diorama shows its depth.
        if (!REDUCED_MOTION) {
            const k = 1 - Math.exp(-dt * 2);
            const d = this.camDrift;
            d.x += (((x - W / 2) / (W / 2)) * DRIFT_X - d.x) * k;
            d.y += (((y - H / 2) / (H / 2)) * DRIFT_Y - d.y) * k;
            this.camera.position.copy(this.camBase).add(d);
            this.camera.lookAt(this.camLook);
        }

        this.effects.update(dt);
        this.composer.render();
    }

    private build(cv: Cavern, n: number) {
        this.built = cv;
        this.effects.clear();
        this.level.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.geometry) mesh.geometry.dispose();
            const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
            if (mat) for (const mm of Array.isArray(mat) ? mat : [mat]) mm.dispose();
        });
        this.level.clear();
        for (const b of this.belts) b.dispose();
        this.belts = [];
        const th = (this.theme = themeFor(n));
        const tiles = cv.tiles;
        const at = (c: number, r: number) => (c < 0 || c >= W || r < 0 || r >= H ? "#" : tiles[r * W + c]);
        const cells = (ch: string) => {
            const out: number[] = [];
            for (let i = 0; i < tiles.length; i++) if (tiles[i] === ch) out.push(i);
            return out;
        };
        const shadows = (o: THREE.Object3D) => ((o.castShadow = o.receiveShadow = this.ts.shadowMap > 0), o);
        const jitter = rng(n * 31 + 7);

        // Backdrop: copper bars and faint brickwork, plus a dark surround for wide screens.
        const back = new THREE.Mesh(
            new THREE.PlaneGeometry(W, H),
            new THREE.MeshStandardMaterial({ map: backdrop(th), roughness: 1 })
        );
        back.position.set(W / 2, H / 2, -DEPTH / 2 - 0.02);
        back.receiveShadow = this.ts.shadowMap > 0;
        this.level.add(back);

        const blocks = (list: number[], geo: THREE.BufferGeometry, mat: THREE.Material, y: number, color: number) => {
            const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
            mesh.count = list.length;
            const col = new THREE.Color();
            list.forEach((i, k) => {
                this.m4.makeTranslation((i % W) + 0.5, H - Math.floor(i / W) - y, 0);
                mesh.setMatrixAt(k, this.m4);
                mesh.setColorAt(k, col.setHex(color).multiplyScalar(0.9 + jitter() * 0.2));
            });
            this.level.add(shadows(mesh));
            return mesh;
        };
        // Slightly rounded blocks catch a highlight on every edge; each texture doubles as its bump map.
        const cube = new RoundedBoxGeometry(1, 1, DEPTH, 2, 0.05);
        const slab = new RoundedBoxGeometry(1, 0.32, DEPTH, 2, 0.04);
        blocks(
            cells("#"),
            cube,
            new THREE.MeshStandardMaterial({
                map: this.tex.rock,
                bumpMap: this.tex.rock,
                bumpScale: 2,
                roughness: 0.9,
            }),
            0.5,
            th.rock
        );
        blocks(
            cells("="),
            slab,
            new THREE.MeshStandardMaterial({ map: this.tex.ledge, bumpMap: this.tex.ledge, roughness: 0.8 }),
            0.16,
            th.ledge
        );
        this.crumbleCells = cells("~");
        this.crumble = blocks(
            this.crumbleCells,
            slab.clone(),
            new THREE.MeshStandardMaterial({
                map: this.tex.crumble,
                bumpMap: this.tex.crumble,
                bumpScale: 2,
                roughness: 1,
            }),
            0.16,
            th.crumble
        );
        for (const [ch, dir] of [
            ["<", -1],
            [">", 1],
        ] as const) {
            const map = this.tex.belt.clone();
            map.userData.dir = dir;
            map.needsUpdate = true;
            this.belts.push(map);
            blocks(
                cells(ch),
                slab.clone(),
                new THREE.MeshStandardMaterial({ map, bumpMap: map, roughness: 0.5, metalness: 0.3 }),
                0.16,
                th.belt
            );
        }
        this.doors = new THREE.Group();
        const doorMesh = blocks(
            cells("D"),
            cube.clone(),
            new THREE.MeshStandardMaterial({
                map: this.tex.door,
                bumpMap: this.tex.door,
                emissive: COLORS.doorGlow,
                emissiveIntensity: 0.25,
            }),
            0.5,
            COLORS.door
        );
        this.level.remove(doorMesh);
        this.doors.add(doorMesh);
        this.level.add(this.doors);

        // Neon edge strips on every surface you can stand on.
        const tops: number[] = [];
        for (let i = 0; i < tiles.length; i++)
            if ("#=~<>".includes(tiles[i]) && !"#D".includes(at(i % W, Math.floor(i / W) - 1)) && i >= W) tops.push(i);
        const strips = new THREE.InstancedMesh(
            new THREE.BoxGeometry(1.02, 0.05, 0.05),
            new THREE.MeshBasicMaterial({ color: hdr(th.glow, 1.5), toneMapped: false }),
            Math.max(1, tops.length)
        );
        strips.count = tops.length;
        tops.forEach((i, k) => {
            this.m4.makeTranslation((i % W) + 0.5, H - Math.floor(i / W) + 0.01, DEPTH / 2 + 0.02);
            strips.setMatrixAt(k, this.m4);
        });
        this.level.add(strips);

        // Spikes: two cones per cell, pointing away from whatever they grow on.
        const spikes = cells("^");
        const cone = new THREE.ConeGeometry(0.2, 0.72, 5);
        const spikeMesh = new THREE.InstancedMesh(
            cone,
            new THREE.MeshStandardMaterial({
                color: COLORS.spike,
                metalness: 0.6,
                roughness: 0.3,
                emissive: COLORS.spikeTip,
                emissiveIntensity: 0.35,
            }),
            Math.max(1, spikes.length * 2)
        );
        spikeMesh.count = spikes.length * 2;
        const q = new THREE.Quaternion();
        spikes.forEach((i, k) => {
            const c = i % W,
                r = Math.floor(i / W);
            const down = !"#D=~<>".includes(at(c, r + 1)) && "#D=~<>".includes(at(c, r - 1));
            q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), down ? Math.PI : 0);
            for (let j = 0; j < 2; j++) {
                this.m4.compose(
                    this.v3.set(c + 0.28 + j * 0.44, H - r - (down ? 0.36 : 0.64), 0),
                    q,
                    new THREE.Vector3(1, 1, 1)
                );
                spikeMesh.setMatrixAt(k * 2 + j, this.m4);
            }
        });
        this.level.add(shadows(spikeMesh));

        this.crystals = cv.crystals.map(([c, r]) => {
            const m = new THREE.Mesh(
                new THREE.OctahedronGeometry(0.3 * SPRITE),
                new THREE.MeshBasicMaterial({ toneMapped: false })
            );
            m.scale.y = 1.35;
            m.userData.y = H - r - 0.5;
            m.position.set(c + 0.5, m.userData.y, 0);
            this.level.add(m);
            return m;
        });

        this.levers = cv.levers.map(([c, r]) => {
            const g = new THREE.Group();
            const base = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.15, 0.4),
                new THREE.MeshStandardMaterial({ color: 0x404050 })
            );
            const arm = new THREE.Group();
            const stick = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.6, 0.08),
                new THREE.MeshStandardMaterial({ color: COLORS.lever, metalness: 0.7, roughness: 0.3 })
            );
            stick.position.y = 0.3;
            const knob = new THREE.Mesh(
                new THREE.SphereGeometry(0.1, 8, 6),
                new THREE.MeshBasicMaterial({ color: hdr(COLORS.leverOn, 1.6), toneMapped: false })
            );
            knob.position.y = 0.62;
            arm.add(stick, knob);
            g.add(base, arm);
            g.position.set(c + 0.5, H - r - 0.92, 0);
            this.level.add(g);
            return g;
        });

        // Portal: a 2 × 2 frame around a glowing core.
        const pg = new THREE.Group();
        const frame = new THREE.MeshBasicMaterial({ toneMapped: false });
        const core = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.9 });
        for (const [x, y, w, h] of [
            [0, 0.92, 2, 0.16],
            [0, -0.92, 2, 0.16],
            [-0.92, 0, 0.16, 2],
            [0.92, 0, 0.16, 2],
        ])
            pg.add(box(w, h, 0.3, frame, x, y, 0));
        const inner = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), core);
        inner.position.z = -0.05;
        pg.add(inner);
        pg.position.set(cv.portal.c + 1, H - cv.portal.r - 1, 0);
        this.level.add(pg);
        this.portal = { group: pg, frame, core };
        this.portalLight.color.setHex(th.glow);
        this.portalLight.position.set(cv.portal.c + 1, H - cv.portal.r - 1, 1.2);

        const hue = (n * 0.137) % 1;
        const walker = [robotModel, crawlerModel, blobModel][n % 3];
        this.guardians = cv.guardians.map((gd: Guardian) => {
            const col = new THREE.Color().setHSL(
                hue + (gd.kind === "lift" ? 0.33 : gd.kind === "fly" ? 0.6 : 0),
                0.65,
                0.5
            );
            const v = gd.kind === "lift" ? droneModel(col) : gd.kind === "fly" ? batModel(col) : walker(col);
            v.group.traverse((o) => (o.castShadow = this.ts.shadowMap > 0));
            v.group.scale.setScalar(SPRITE);
            if (gd.kind !== "lift") v.group.rotation.y = gd.dir > 0 ? FACE_R : FACE_L;
            this.level.add(v.group, patrolZone(gd, col));
            return v;
        });
        this.miner.group.traverse((o) => (o.castShadow = this.ts.shadowMap > 0));
    }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A faint tint on the back wall over the box a guardian sweeps, so its patrol reads at a glance. */
function patrolZone(gd: Guardian, col: THREE.Color) {
    const lift = gd.kind === "lift";
    const x0 = lift ? gd.x : gd.min,
        x1 = lift ? gd.x + 8 : gd.max + 8;
    const y0 = lift ? gd.min : gd.y,
        y1 = lift ? gd.max + 16 : gd.y + 16;
    const m = new THREE.Mesh(
        new THREE.PlaneGeometry((x1 - x0) / 8, (y1 - y0) / 8),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.14, depthWrite: false })
    );
    m.position.set((x0 + x1) / 16, H - (y0 + y1) / 16, -DEPTH / 2 - 0.01);
    return m;
}

// ---- Models ---------------------------------------------------------------------------------------
// Each model is a Group with its feet at the origin, facing +x, about 1 wide and 2 tall,
// plus a pose(t, moving) function that animates it.

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
}
const std = (color: number | THREE.Color, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
const glow = (color: number | THREE.Color, k = 2) =>
    new THREE.MeshBasicMaterial({
        color: hdr(typeof color === "number" ? color : color.getHex(), k),
        toneMapped: false,
    });

function limb(w: number, h: number, mat: THREE.Material, x: number, y: number) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    pivot.add(box(w, h, w, mat, 0, -h / 2, 0));
    return pivot;
}

function minerModel() {
    const g = new THREE.Group();
    const overalls = std(COLORS.overalls),
        skin = std(COLORS.skin),
        helmet = std(COLORS.helmet, { metalness: 0.2, roughness: 0.4 }),
        boots = std(COLORS.boots);
    const legs = [limb(0.24, 0.62, overalls, -0.12, 0.82), limb(0.24, 0.62, overalls, 0.12, 0.82)];
    legs.forEach((l, i) => l.add(box(0.3, 0.16, 0.34, boots, 0.04, -0.62, 0)) && (l.position.z = i ? 0.12 : -0.12));
    const arms = [limb(0.16, 0.5, std(COLORS.shirt), 0, 1.35), limb(0.16, 0.5, std(COLORS.shirt), 0, 1.35)];
    arms[0].position.z = -0.3;
    arms[1].position.z = 0.3;
    g.add(...legs, ...arms);
    g.add(box(0.56, 0.62, 0.5, overalls, 0, 1.12, 0));
    g.add(box(0.44, 0.42, 0.42, skin, 0, 1.64, 0));
    g.add(box(0.52, 0.18, 0.5, helmet, 0, 1.92, 0));
    g.add(box(0.2, 0.05, 0.5, helmet, 0.3, 1.84, 0));
    g.add(box(0.1, 0.12, 0.12, glow(COLORS.lamp, 3), 0.28, 1.95, 0));
    g.add(
        box(0.06, 0.06, 0.06, std(0x101018), 0.22, 1.68, 0.1),
        box(0.06, 0.06, 0.06, std(0x101018), 0.22, 1.68, -0.1)
    );
    const pose: Pose = (t, moving) => {
        const s = moving ? Math.sin(t) * 0.7 : 0;
        legs[0].rotation.z = moving ? s : 0.5;
        legs[1].rotation.z = moving ? -s : -0.3;
        arms[0].rotation.z = moving ? -s : 2.4;
        arms[1].rotation.z = moving ? s : 2.4;
    };
    return { group: g, pose };
}

function robotModel(col: THREE.Color): { group: THREE.Group; pose: Pose } {
    const g = new THREE.Group();
    const body = std(col, { metalness: 0.5, roughness: 0.35 });
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 10), std(0x202028));
    wheel.rotation.x = Math.PI / 2;
    wheel.position.y = 0.28;
    const torso = box(0.7, 0.8, 0.6, body, 0, 0.95, 0);
    const head = box(0.5, 0.36, 0.5, body, 0, 1.55, 0);
    const eye = box(0.08, 0.12, 0.36, glow(COLORS.guardianEye, 2.5), 0.26, 1.57, 0);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), glow(col, 2.5));
    tip.position.y = 1.98;
    g.add(wheel, torso, head, eye, box(0.04, 0.3, 0.04, std(0x9090a0), 0, 1.82, 0), tip);
    return {
        group: g,
        pose: (t) => {
            wheel.rotation.y = t * 8;
            head.rotation.y = Math.sin(t * 2) * 0.3;
            torso.position.y = 0.95 + Math.abs(Math.sin(t * 8)) * 0.04;
        },
    };
}

function crawlerModel(col: THREE.Color): { group: THREE.Group; pose: Pose } {
    const g = new THREE.Group();
    const shell = std(col, { roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), shell);
    body.scale.set(1.2, 0.75, 1);
    body.position.y = 0.6;
    g.add(body);
    const legs: THREE.Group[] = [];
    for (let i = 0; i < 6; i++) {
        const l = limb(0.07, 0.55, std(col.clone().multiplyScalar(0.6)), -0.3 + (i % 3) * 0.3, 0.6);
        l.position.z = i < 3 ? 0.32 : -0.32;
        l.rotation.x = i < 3 ? -0.7 : 0.7;
        legs.push(l);
        g.add(l);
    }
    g.add(
        box(0.1, 0.1, 0.1, glow(COLORS.guardianEye, 3), 0.48, 0.7, 0.14),
        box(0.1, 0.1, 0.1, glow(COLORS.guardianEye, 3), 0.48, 0.7, -0.14)
    );
    return {
        group: g,
        pose: (t) => legs.forEach((l, i) => (l.rotation.z = Math.sin(t * 12 + i * 2) * 0.4)),
    };
}

function blobModel(col: THREE.Color): { group: THREE.Group; pose: Pose } {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.55, 1),
        std(col, {
            transparent: true,
            opacity: 0.85,
            roughness: 0.15,
            emissive: col,
            emissiveIntensity: 0.25,
            flatShading: true,
        })
    );
    body.position.y = 0.55;
    g.add(body);
    const eyes = new THREE.Group();
    eyes.add(
        box(0.12, 0.16, 0.12, glow(0xffffff, 2), 0.4, 0.75, 0.16),
        box(0.12, 0.16, 0.12, glow(0xffffff, 2), 0.4, 0.75, -0.16)
    );
    g.add(eyes);
    return {
        group: g,
        pose: (t) => {
            const s = Math.sin(t * 7);
            body.scale.set(1 + s * 0.12, 1 - s * 0.15, 1 + s * 0.12);
            body.position.y = 0.55 - s * 0.08;
            eyes.position.y = -s * 0.1;
        },
    };
}

function batModel(col: THREE.Color): { group: THREE.Group; pose: Pose } {
    const g = new THREE.Group();
    const fur = std(col, { roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), fur);
    body.position.y = 1;
    const wings = [new THREE.Group(), new THREE.Group()];
    wings.forEach((w, i) => {
        w.position.set(0, 1.05, i ? 0.25 : -0.25);
        const m = box(
            0.7,
            0.04,
            0.6,
            std(col.clone().multiplyScalar(0.5), { side: THREE.DoubleSide }),
            0,
            0,
            i ? 0.3 : -0.3
        );
        w.add(m);
        g.add(w);
    });
    g.add(
        body,
        box(0.08, 0.08, 0.08, glow(COLORS.guardianEye, 3), 0.28, 1.08, 0.1),
        box(0.08, 0.08, 0.08, glow(COLORS.guardianEye, 3), 0.28, 1.08, -0.1)
    );
    return {
        group: g,
        pose: (t) => {
            const f = Math.sin(t * 16) * 0.8;
            wings[0].rotation.x = f;
            wings[1].rotation.x = -f;
            body.position.y = 1 + Math.sin(t * 4) * 0.1;
        },
    };
}

function droneModel(col: THREE.Color): { group: THREE.Group; pose: Pose } {
    const g = new THREE.Group();
    const core = box(0.7, 0.7, 0.7, std(col, { metalness: 0.6, roughness: 0.3 }), 0, 1, 0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 24), glow(col, 2.2));
    ring.position.y = 1;
    const eye = box(0.2, 0.2, 0.2, glow(COLORS.guardianEye, 3), 0, 1, 0.36);
    g.add(core, ring, eye);
    return {
        group: g,
        pose: (t) => {
            core.rotation.set(t * 1.3, t * 1.7, 0);
            ring.rotation.set(Math.PI / 2 + Math.sin(t * 2) * 0.4, 0, t * 3);
        },
    };
}

// ---- Textures -----------------------------------------------------------------------------------
// Tiny greyscale pixel-art tiles, tinted per instance; nearest filtering keeps them crisp.

function canvasTex(size: number, paint: (g: CanvasRenderingContext2D, r: () => number) => void, seed: number) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    paint(c.getContext("2d")!, rng(seed));
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

function textures() {
    const speckle = (g: CanvasRenderingContext2D, r: () => number, n: number, lo: number, hi: number) => {
        for (let i = 0; i < n; i++) {
            const v = Math.floor(lo + r() * (hi - lo));
            g.fillStyle = `rgb(${v},${v},${v})`;
            g.fillRect(Math.floor(r() * 16), Math.floor(r() * 16), 1, 1);
        }
    };
    const bevel = (g: CanvasRenderingContext2D) => {
        g.fillStyle = "rgba(255,255,255,0.35)";
        g.fillRect(0, 0, 16, 1);
        g.fillRect(0, 0, 1, 16);
        g.fillStyle = "rgba(0,0,0,0.45)";
        g.fillRect(0, 15, 16, 1);
        g.fillRect(15, 0, 1, 16);
    };
    return {
        rock: canvasTex(
            16,
            (g, r) => {
                g.fillStyle = "#c8c8c8";
                g.fillRect(0, 0, 16, 16);
                // Mottled stone: soft 2 × 2 blotches, then fine grit.
                for (let i = 0; i < 14; i++) {
                    const v = Math.floor(140 + r() * 90);
                    g.fillStyle = `rgb(${v},${v},${v})`;
                    g.fillRect(Math.floor(r() * 15), Math.floor(r() * 15), 2, 2);
                }
                speckle(g, r, 50, 150, 235);
                bevel(g);
            },
            4242
        ),
        ledge: canvasTex(
            16,
            (g, r) => {
                g.fillStyle = "#d8d8d8";
                g.fillRect(0, 0, 16, 16);
                speckle(g, r, 30, 170, 250);
                g.fillStyle = "rgba(0,0,0,0.3)";
                for (const y of [5, 11]) g.fillRect(0, y, 16, 1);
                g.fillRect(7, 0, 1, 5);
                g.fillRect(12, 6, 1, 5);
                bevel(g);
            },
            4243
        ),
        crumble: canvasTex(
            16,
            (g, r) => {
                g.fillStyle = "#b8b8b8";
                g.fillRect(0, 0, 16, 16);
                speckle(g, r, 90, 60, 230);
                g.fillStyle = "rgba(0,0,0,0.55)";
                for (let i = 0; i < 4; i++) g.fillRect(Math.floor(r() * 16), 0, 1, 6 + Math.floor(r() * 10));
            },
            4244
        ),
        belt: canvasTex(
            16,
            (g) => {
                g.fillStyle = "#909090";
                g.fillRect(0, 0, 16, 16);
                g.fillStyle = "#e8e8e8";
                for (let x = 0; x < 16; x += 8) for (let y = 0; y < 16; y++) g.fillRect((x + y) % 16, y, 3, 1);
                g.fillStyle = "#404040";
                g.fillRect(0, 0, 16, 1);
                g.fillRect(0, 15, 16, 1);
            },
            4245
        ),
        door: canvasTex(
            16,
            (g) => {
                g.fillStyle = "#c0c0c0";
                g.fillRect(0, 0, 16, 16);
                g.fillStyle = "#707070";
                for (const x of [3, 8, 13]) g.fillRect(x, 0, 1, 16);
                g.fillStyle = "#f0f0f0";
                g.fillRect(0, 3, 16, 2);
                g.fillRect(0, 11, 16, 2);
                bevel(g);
            },
            4246
        ),
    };
}

/** Copper bars (banded vertical gradient) with faint brickwork over it. */
function backdrop(th: Theme) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 128);
    th.bars.forEach((s, i) => grad.addColorStop(i / (th.bars.length - 1), s));
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 128);
    // Quantise into bands, the copper-list look: each band is one flat colour.
    const img = g.getImageData(0, 0, 1, 128).data;
    for (let y = 0; y < 128; y += 4) {
        g.fillStyle = `rgb(${img[y * 4]},${img[y * 4 + 1]},${img[y * 4 + 2]})`;
        g.fillRect(0, y, 256, 4);
    }
    g.fillStyle = "rgba(0,0,0,0.28)";
    for (let y = 0; y < 128; y += 8) {
        g.fillRect(0, y, 256, 1);
        for (let x = (y / 8) % 2 ? 4 : 0; x < 256; x += 8) g.fillRect(x, y, 1, 8);
    }
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
