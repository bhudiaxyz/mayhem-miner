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
 *     tiers), the miner's helmet lamp (a halo point light plus the torch spotlight aimed from the
 *     voxel lens), shared pixel-art textures, and the composer
 *     (RenderPass → UnrealBloomPass → OutputPass) on a HalfFloat multisampled target.
 *   - build(cavern): disposes the previous cavern's group and builds this one:
 *       rock (#), ledges (=), crumbling ledges (~), conveyors (< >), doors (D) as InstancedMeshes;
 *       glowing edge strips on every air-facing top; spikes; levers; crystals; the portal;
 *       voxel guardian models (render/characters.ts); and the backdrop canvas.
 *   - sync(game, dt): rebuilds when game.cavern changes identity, then poses everything:
 *     crumble wear (ledges sink and shrink), doors, crystals (colour cycling = flashing,
 *     hidden once taken), lever, portal (dark until open, then pulsing), guardians and the
 *     miner, both interpolated between 40 Hz ticks by game.alpha, then renders.
 *   - warmup(): compileAsync over the whole scene plus one composer render, at boot.
 *   - burst(px, py, color, n): sparks at a game-pixel position (main.ts, on events).
 *   - halo(px, py, color): the voxel crystal-pickup halo (fx/effects.ts).
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
import { FALL_LIMIT, JUMP, TICK } from "../core/physics";
import { COLORS, hdr, themeFor, type Theme } from "../core/palette";
import { rng } from "../core/random";
import { H, W, type Cavern, type Guardian } from "../world/caverns";
import { Effects } from "../fx/effects";
import type { TierSettings } from "./tier";
import { backdropTextures, rockTexture, seedOf, tileTextures } from "./paint";
import { crumbleGeometry, crumbleStripGeometry } from "./props";
import { guardianModel, minerModel, TORCH_GLOW, type Character, type Miner, type Mode } from "./characters";

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
/** Back wall brightness (it sits behind the play, so it stays dimmer than ledges and sprites). */
const BACKDROP_BRIGHTNESS = 0.45;
/** Strength of the back wall's glowing features (glowworm stars, ore veins). */
const BACKDROP_GLOW = 0.35;
/** Bloom strength (all glows). Kept modest so the level reads clearly, not hazily. */
const BLOOM_STRENGTH = 0.45;
/** HDR strength of the thin glowing strip along every ledge top (1 = just under bloom). */
const EDGE_GLOW = 1.05;
/** Crumbling ledges' broken strip, as a fraction of EDGE_GLOW: dimmer, so it reads as unsafe. */
const CRUMBLE_STRIP = 0.55;
/** HDR strength of the floating crystals (bloom picks up anything above 1). */
const CRYSTAL_GLOW = 2.4 * 0.85;
/** Seconds a landing squash takes to spring back. */
const LAND_SQUASH = 0.18;
/** The miner's glow: the warm halo point light around him (independent of the torch). */
const MINER_GLOW = 0.75;
/** Torch spotlight strength at full air; scaled by TORCH_GLOW (characters.ts) with the beam and lens. */
const TORCH = 16;
/** Walk cycle radians per game px moved (miner, guardians). */
const STRIDE = 0.35;

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
    private tex = tileTextures();
    /** Ambient fill, tinted per cavern theme (sky from above, ground from below). */
    private hemi = new THREE.HemisphereLight(0xc8d4ff, 0x40302a, 1.5);
    /** Textures painted for the current cavern (rock, back wall), disposed on the next build. */
    private cavernTex: THREE.Texture[] = [];
    // Per-cavern handles, set by build().
    private crumble!: THREE.InstancedMesh;
    private crumbleCells: number[] = [];
    private crumbleStrips!: THREE.InstancedMesh;
    private doors!: THREE.Group;
    private crystals: THREE.Mesh[] = [];
    private levers: THREE.Group[] = [];
    private portal!: { group: THREE.Group; frame: THREE.MeshBasicMaterial; core: THREE.MeshBasicMaterial };
    private guardians: (Character & { dist: number; last: number })[] = [];
    private miner: Miner;
    /** The helmet torch: a spotlight kept in the scene (never hidden, so shaders never recompile). */
    private torch = new THREE.SpotLight(COLORS.lampLight, 0, 12, 0.5, 0.7, 1.4);
    private wasGround = true;
    private landAt = -Infinity;
    private belts: THREE.Texture[] = [];
    private theme!: Theme;
    private m4 = new THREE.Matrix4();
    private v3 = new THREE.Vector3();
    private ao?: GTAOPass;
    private bloom?: UnrealBloomPass;
    /** Governor's resolution scale (1 = the tier's full DPR). */
    private dprScale = 1;
    /** GPU context lost (mobile background / memory pressure): skip rendering until restored. */
    private lost = false;
    /** Ground-level blob shadows: the miner's, one per guardian, and static ones (crystals, props). */
    private blobTex = blobTexture();
    private minerBlob!: THREE.Mesh;
    private guardianBlobs: THREE.Mesh[] = [];
    /** Called when the GPU context is lost (main.ts pauses the run). */
    onContextLost = () => {};

    constructor(
        host: HTMLElement,
        private ts: TierSettings
    ) {
        this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.renderer.shadowMap.enabled = ts.shadowMap > 0;
        // PCF everywhere (PCFSoftShadowMap is deprecated in this three.js); soft tiers blur it via radius.
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        host.append(this.renderer.domElement);
        // Mobile browsers drop the GPU context under memory pressure or in the background. Calling
        // preventDefault lets it be restored (three.js re-uploads everything lazily); until then
        // nothing renders, and main.ts pauses the run.
        const el = this.renderer.domElement;
        el.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            this.lost = true;
            this.onContextLost();
        });
        el.addEventListener("webglcontextrestored", () => (this.lost = false));

        this.scene.background = new THREE.Color(COLORS.ui.bg);
        this.scene.add(this.hemi);
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
            if (ts.softShadows) this.key.shadow.radius = 3;
        }
        // High tier: the helmet torch casts shadows too (ledges and creatures throw them ahead).
        if (ts.shadowMap && ts.torchShadow) {
            this.torch.castShadow = true;
            this.torch.shadow.mapSize.set(512, 512);
            this.torch.shadow.camera.near = 0.2;
            this.torch.shadow.bias = -0.002;
            this.torch.shadow.normalBias = 0.04;
            this.torch.shadow.radius = 2;
        }
        this.scene.add(
            this.key,
            this.key.target,
            this.lamp,
            this.portalLight,
            this.level,
            this.torch,
            this.torch.target
        );
        this.miner = minerModel();
        this.minerBlob = this.makeBlob(0.85);
        this.scene.add(this.miner.group, this.minerBlob);
        this.effects = new Effects(this.scene, ts.particles);

        // HDR (half-float) target where the GPU can render to it; some older Android GPUs can't, and
        // would show nothing, so they get 8-bit (glows clip a little, everything else is the same).
        const ext = this.renderer.extensions;
        const hdrOk = ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float");
        const target = new THREE.WebGLRenderTarget(1, 1, {
            type: hdrOk ? THREE.HalfFloatType : THREE.UnsignedByteType,
            samples: ts.msaa,
        });
        this.composer = new EffectComposer(this.renderer, target);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        if (ts.ao) {
            const ao = new GTAOPass(this.scene, this.camera, 1, 1);
            ao.updateGtaoMaterial({ radius: 0.6, thickness: 1 });
            ao.blendIntensity = 0.8;
            this.composer.addPass(ao);
            this.ao = ao;
        }
        if (ts.bloom) {
            this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_STRENGTH, 0.4, 0.85);
            this.composer.addPass(this.bloom);
        }
        this.composer.addPass(new OutputPass());
        this.resize();
        // The host's size is set by CSS (on portrait phones it leaves room for the controls).
        new ResizeObserver(() => this.resize()).observe(host);
    }

    resize() {
        const host = this.renderer.domElement.parentElement!;
        const w = Math.max(1, host.clientWidth),
            h = Math.max(1, host.clientHeight);
        // DPR: the tier cap, lowered further to keep big screens (iPad Pro, 4K) under the pixel
        // budget, times the governor's scale.
        const budget = Math.sqrt(this.ts.maxPixels / (w * h));
        this.renderer.setPixelRatio(Math.max(0.6, Math.min(devicePixelRatio, this.ts.dprCap, budget) * this.dprScale));
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

    /** A soft dark patch, lying flat on whatever is below; opacity is lower where shadow maps exist. */
    private makeBlob(size: number) {
        const m = new THREE.Mesh(
            BLOB_GEO,
            new THREE.MeshBasicMaterial({
                map: this.blobTex,
                transparent: true,
                depthWrite: false,
                opacity: this.ts.shadowMap ? 0.4 : 0.7,
                color: 0x000000,
            })
        );
        m.userData.size = size;
        m.userData.alpha = m.material.opacity;
        m.renderOrder = 1;
        return m;
    }

    /**
     * Put a blob on the first surface at or below world (x, feetY): rock, ledge, crumble, belt or
     * a closed door, read from the live tiles (so it drops when a ledge crumbles or a door opens).
     * It shrinks and fades with height, and is hidden with nothing below.
     */
    private placeBlob(b: THREE.Mesh, tiles: string | string[], x: number, feetY: number, scale = 1) {
        const c = Math.min(W - 1, Math.max(0, Math.floor(x)));
        let top = -1;
        for (let r = Math.max(0, Math.ceil(H - feetY - 0.05)); r < H; r++)
            if ("#=~<>D".includes(tiles[r * W + c])) {
                top = H - r;
                break;
            }
        const h = feetY - top;
        b.visible = top >= 0 && h > -0.1 && scale > 0.05;
        if (!b.visible) return;
        const k = Math.max(0.25, 1 - h / 7);
        b.position.set(x, top + 0.015, 0);
        b.scale.setScalar(b.userData.size * k * scale);
        (b.material as THREE.MeshBasicMaterial).opacity = b.userData.alpha * k;
    }

    /**
     * One step down in quality, for the Governor (render/tier.ts), cheapest-to-lose first:
     * ambient occlusion, then resolution (×0.8 a step down to DPR 1), then bloom, then shadows.
     * Returns false when there is nothing left to shed.
     */
    degrade(): boolean {
        const step = (what: string) => (console.info(`[mayhem-miner] smoother frames: ${what}`), true);
        if (this.ao?.enabled) return ((this.ao.enabled = false), step("ambient occlusion off"));
        if (this.renderer.getPixelRatio() > 1.01) {
            this.dprScale *= 0.8;
            this.resize();
            return step(`resolution ×${this.renderer.getPixelRatio().toFixed(2)}`);
        }
        if (this.bloom?.enabled) return ((this.bloom.enabled = false), step("bloom off"));
        if (this.renderer.shadowMap.enabled) {
            this.renderer.shadowMap.enabled = this.key.castShadow = this.torch.castShadow = false;
            this.scene.traverse((o) => {
                const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
                if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
            });
            return step("shadows off");
        }
        return false;
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

    /** A blocky voxel halo and light flash at a game-pixel position (crystal pickups). */
    halo(px: number, py: number, color: number) {
        this.effects.halo(px / 8, H - py / 8, hdr(color, 2.4));
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
            // Its glow strip rides the top of the sinking slab and goes with it.
            this.m4
                .makeScale(s ? 1 : 0, s ? 1 : 0, s ? 1 : 0)
                .setPosition(c + 0.5 + shake, H - r + 0.01 - w * 0.25 - 0.32 * (1 - s) * 0.5, DEPTH / 2 + 0.02);
            this.crumbleStrips.setMatrixAt(k, this.m4);
        });
        if (this.crumbleCells.length) {
            this.crumble.instanceMatrix.needsUpdate = true;
            this.crumbleStrips.instanceMatrix.needsUpdate = true;
        }
        this.doors.visible = !g.doorsOpen;
        for (const b of this.belts) b.offset.x -= (b.userData.dir as number) * dt * 1.2;

        this.crystals.forEach((m, i) => {
            m.visible = !g.got[i];
            if (!m.visible) return;
            m.rotation.y = t * 2 + i;
            m.position.y = (m.userData.y as number) + Math.sin(t * 3 + i) * 0.06;
            const cyc = COLORS.crystalCycle;
            (m.material as THREE.MeshBasicMaterial).color.copy(
                hdr(cyc[(Math.floor(t * 8) + i) % cyc.length], CRYSTAL_GLOW)
            );
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
            const p = gd.kind === "lift" ? y : x;
            v.dist += Math.abs(p - v.last);
            v.last = p;
            // A lift's anchor is the top of its range (a spider's silk runs up to it).
            const reach = gd.kind === "lift" ? (y - gd.min) / 8 / SPRITE + 2 / SPRITE : 0;
            v.pose({ dt, t, phase: v.dist * STRIDE, mode: "walk", land: 0, reach });
            this.placeBlob(this.guardianBlobs[i], g.tiles, x / 8 + 0.5, H - y / 8 - 2);
        });

        const m = g.miner;
        const mg = this.miner.group;
        // Seconds since a death (the miner tumbles for TUMBLE of the DEAD_PAUSE).
        const since = g.phase === "dead" ? DEAD_PAUSE - g.timer + a * TICK : Infinity;
        const show = !g.demo && (g.phase === "play" || (g.phase === "complete" && g.air > 0) || since < TUMBLE);
        mg.visible = show;
        this.minerBlob.visible = show;
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
            // 1 normally; fades through a death tumble and gutters on low air. Drives glow and torch.
            let power = 1;
            if (since < TUMBLE) {
                const k = since / TUMBLE;
                y += since * 3 - since * since * 8;
                s = 1 - k;
                mg.rotation.z = -m.face * since * 9;
                power *= 1 - k;
            }
            mg.position.set(x, y, 0);
            mg.scale.setScalar(s * SPRITE);
            this.placeBlob(this.minerBlob, g.tiles, x, y, s);
            // Legs follow distance walked, interpolated to the drawn position (not 40 Hz steps).
            const walk = m.walk - Math.abs(m.x - m.px) * (1 - a);
            const ground = m.mode === "ground";
            // game.time restarts at 0 on every cavern load and restart: a landing remembered from
            // before must not count (it made the squash huge: a giant, flipped miner until the
            // next landing).
            if (t < this.landAt) this.landAt = -Infinity;
            if (ground && !this.wasGround) this.landAt = t;
            this.wasGround = ground;
            const mode: Mode =
                doomed || since < TUMBLE
                    ? "flail"
                    : ground
                      ? m.x !== m.px
                          ? "walk"
                          : "idle"
                      : m.mode === "jump" && JUMP[m.t] < 0
                        ? "rise"
                        : "fall";
            const land = Math.min(1, Math.max(0, 1 - (t - this.landAt) / LAND_SQUASH));
            this.miner.pose({ dt, t, phase: walk * STRIDE, mode, land });
            // Low air: the lamp dims and (motion allowing) gutters.
            const f = g.air / g.cavern.air;
            if (g.phase === "play" && f < 0.2)
                power *= (0.45 + 2.75 * f) * (REDUCED_MOTION ? 1 : 0.75 + 0.25 * Math.sin(t * 31) * Math.sin(t * 7.7));
            this.lamp.position.set(x + m.face * 0.3, y + 1.9 * SPRITE, 1.4);
            this.lamp.intensity = 9 * MINER_GLOW * power;
            // The torch beam follows the head (bob, lean, look) from the lens.
            mg.updateMatrixWorld(true);
            this.miner.lens.getWorldPosition(this.torch.position);
            this.miner.aim.getWorldPosition(this.torch.target.position);
            this.torch.intensity = TORCH * TORCH_GLOW * power;
            this.miner.beam.material.color.setScalar(TORCH_GLOW * power);
        } else {
            this.lamp.intensity = g.demo ? 0 : this.lamp.intensity * 0.9;
            this.torch.intensity = 0;
        }
        this.lamp.color.setHex(doomed && Math.floor(t * 12) % 2 ? COLORS.lampDanger : COLORS.lampLight);
        this.torch.color.copy(this.lamp.color);

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
        if (!this.lost) this.composer.render();
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
        for (const t of this.cavernTex) t.dispose();
        const th = (this.theme = themeFor(n));
        // Seeded by name, so a cavern's surfaces are the same every visit.
        const seed = seedOf(cv.name);
        const rockTex = rockTexture(th.rockStyle, seed);
        const backTex = backdropTextures(th, seed);
        this.cavernTex = [rockTex, backTex.map, backTex.glow];
        this.hemi.color.setHex(th.sky);
        this.hemi.groundColor.setHex(th.ground);
        this.effects.motes(th.motes, th.mote, Math.round(this.ts.particles / 8));
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
            new THREE.MeshStandardMaterial({
                map: backTex.map,
                color: new THREE.Color().setScalar(BACKDROP_BRIGHTNESS),
                emissive: 0xffffff,
                emissiveMap: backTex.glow,
                emissiveIntensity: BACKDROP_GLOW,
                roughness: 1,
            })
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
                map: rockTex,
                bumpMap: rockTex,
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
            crumbleGeometry(),
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
            if ("#=<>".includes(tiles[i]) && !"#D".includes(at(i % W, Math.floor(i / W) - 1)) && i >= W) tops.push(i);
        const strips = new THREE.InstancedMesh(
            new THREE.BoxGeometry(1.02, 0.05, 0.05),
            new THREE.MeshBasicMaterial({ color: hdr(th.glow, EDGE_GLOW), toneMapped: false }),
            Math.max(1, tops.length)
        );
        strips.count = tops.length;
        tops.forEach((i, k) => {
            this.m4.makeTranslation((i % W) + 0.5, H - Math.floor(i / W) + 0.01, DEPTH / 2 + 0.02);
            strips.setMatrixAt(k, this.m4);
        });
        // Crumbling ledges: a dimmer, broken strip (one per crumble cell, posed with its wear in sync).
        this.crumbleStrips = new THREE.InstancedMesh(
            crumbleStripGeometry(),
            new THREE.MeshBasicMaterial({ color: hdr(th.glow, EDGE_GLOW * CRUMBLE_STRIP), toneMapped: false }),
            Math.max(1, this.crumbleCells.length)
        );
        this.crumbleStrips.count = this.crumbleCells.length;
        this.level.add(this.crumbleStrips);
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

        // Each cavern's creatures get their own palette (seeded by name): a hue family set
        // opposite the back wall's so they always stand out, a cavern-wide saturation and
        // lightness, and a slightly different shade for every creature. Kinds stay apart in hue.
        const pal = rng(seed ^ 0x5bd1e995);
        const bg = { h: 0, s: 0, l: 0 };
        new THREE.Color(th.bars[3]).getHSL(bg, THREE.SRGBColorSpace);
        const family = bg.h + 0.35 + pal() * 0.3,
            sat = 0.5 + pal() * 0.35,
            light = 0.42 + pal() * 0.16;
        const KIND_HUE = { walk: 0, fly: 0.14, lift: -0.14 };
        this.guardians = cv.guardians.map((gd: Guardian) => {
            const h = family + KIND_HUE[gd.kind] + (pal() - 0.5) * 0.08;
            const col = new THREE.Color().setHSL(
                ((h % 1) + 1) % 1,
                Math.min(1, sat + (pal() - 0.5) * 0.15),
                light + (pal() - 0.5) * 0.12,
                THREE.SRGBColorSpace
            );
            const v = guardianModel(gd.kind, n, col);
            v.group.traverse((o) => (o.castShadow = this.ts.shadowMap > 0 && !o.userData.fx));
            v.group.scale.setScalar(SPRITE);
            if (gd.kind !== "lift") v.group.rotation.y = gd.dir > 0 ? FACE_R : FACE_L;
            this.level.add(v.group, patrolZone(gd, col));
            return { ...v, dist: 0, last: gd.kind === "lift" ? gd.y : gd.x };
        });
        // Ground-level shadows (every tier): moving ones are placed in sync, static ones here.
        this.guardianBlobs = cv.guardians.map(() => {
            const b = this.makeBlob(0.9);
            this.level.add(b);
            return b;
        });
        const still = (wx: number, feet: number, size: number) => {
            const b = this.makeBlob(size);
            this.level.add(b);
            this.placeBlob(b, cv.tiles, wx, feet);
        };
        cv.crystals.forEach(([c, r]) => still(c + 0.5, H - r - 1, 0.5));
        cv.levers.forEach(([c, r]) => still(c + 0.5, H - r - 1, 0.6));
        still(cv.portal.c + 1, H - cv.portal.r - 2, 2);
        cells("^").forEach((i) => still((i % W) + 0.5, H - Math.floor(i / W) - 1, 0.9));
        this.miner.group.traverse((o) => (o.castShadow = this.ts.shadowMap > 0 && !o.userData.fx));
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
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.07, depthWrite: false })
    );
    m.position.set((x0 + x1) / 16, H - (y0 + y1) / 16, -DEPTH / 2 - 0.01);
    return m;
}

/**
 * A blob shadow's quad: on the ground, wider than deep (x by z), tilted BLOB_TILT toward the
 * camera, which sees ledge tops almost edge-on, and lifted so its front edge rests on the surface.
 */
const BLOB_TILT = 0.35;
const BLOB_GEO = new THREE.PlaneGeometry(1, DEPTH * 0.85)
    .rotateX(-Math.PI / 2 + BLOB_TILT)
    .translate(0, ((DEPTH * 0.85) / 2) * Math.sin(BLOB_TILT), 0);

function blobTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

// Plain box mesh, for the portal frame.
function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
}
