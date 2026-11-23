/**
 * Characters — the miner and the guardians, built from voxel cubes and rigged for animation.
 *
 * Purpose
 *   Every character is a small hierarchy of voxel parts (torso, head, legs, arms, wings, …),
 *   each hung from a joint so a pose only has to rotate or move joints.
 *
 * Operations
 *   - voxelFaces(boxes): fills a voxel grid from boxes (later boxes paint over earlier ones)
 *     and returns only the faces exposed to air, split into lit and glowing sets. Each voxel
 *     gets a small brightness jitter so the cubes read individually. Pure, no DOM.
 *   - minerModel(): Pip, with a helmet torch (glowing lens, soft beam and a `lens` / `aim`
 *     pair that view.ts follows with a spotlight).
 *   - guardianModel(kind, style, colour): robot, beetle or slime walkers, bat flyers, drone lifts.
 *   - Character.pose(state): moves the joints toward the state's target pose, eased by dt, so
 *     idle → walk → jump → fall blend instead of snapping. Freezes when dt is 0 (paused).
 *
 * Usage
 *   view.ts builds the models once per cavern and calls pose() every frame.
 *
 * Highlights
 *   - One voxel is 1/8 unit: a 1 × 2 cell character is 8 × 16 voxels, the game's 8 px grid.
 *   - Models stand on the origin and face +x; z runs across the body (left / right side).
 *   - Each part is at most two meshes (lit + glow), however many voxels it has.
 *
 * See also: render/view.ts (placement, facing, death tumble); DESIGN.md "11. Rendering".
 */
import * as THREE from "three";
import { COLORS } from "../core/palette";

export const VOX = 1 / 8;
/** Helmet torch strength: lens glow and beam here, spotlight in view.ts. The miner's halo glow is separate (view.ts MINER_GLOW). */
export const TORCH_GLOW = 1;

/** [x, y, z, w, h, d, colour, glow?] in voxels. glow > 0 makes the voxels emit at that HDR strength. */
export type Box = [number, number, number, number, number, number, number, number?];

export type Mode = "idle" | "walk" | "rise" | "fall" | "flail";
export interface PoseState {
    /** Seconds since the last frame (0 while paused). */
    dt: number;
    /** Seconds, for idle motion. */
    t: number;
    /** Walk cycle in radians, driven by distance moved so feet match the ground. */
    phase: number;
    mode: Mode;
    /** Landing squash, 1 on touchdown easing to 0. */
    land: number;
}
export interface Character {
    group: THREE.Group;
    pose(s: PoseState): void;
}

export interface FaceSet {
    pos: number[];
    nrm: number[];
    col: number[];
}

/** Unit-cube faces as [normal, 4 corners], wound counter-clockwise seen from outside. */
const FACES = [0, 1, 2].flatMap((ax) =>
    [1, -1].map((s) => {
        const u = (ax + 1) % 3,
            v = (ax + 2) % 3;
        const corner = (a: number, b: number) => {
            const p = [0, 0, 0];
            p[ax] = s > 0 ? 1 : 0;
            p[u] = a;
            p[v] = b;
            return p;
        };
        const quad = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)];
        const n = [0, 0, 0];
        n[ax] = s;
        return { n, quad: s > 0 ? quad : quad.reverse() };
    })
);

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

export function voxelFaces(boxes: Box[]): { solid: FaceSet; glow: FaceSet } {
    const grid = new Map<string, { x: number; y: number; z: number; c: number; g: number }>();
    for (const [x0, y0, z0, w, h, d, c, g = 0] of boxes)
        for (let x = x0; x < x0 + w; x++)
            for (let y = y0; y < y0 + h; y++)
                for (let z = z0; z < z0 + d; z++) grid.set(key(x, y, z), { x, y, z, c, g });
    const solid: FaceSet = { pos: [], nrm: [], col: [] };
    const glow: FaceSet = { pos: [], nrm: [], col: [] };
    const rgb = new THREE.Color();
    for (const { x, y, z, c, g } of grid.values()) {
        const j = 0.9 + 0.16 * hash(x, y, z);
        rgb.setHex(c).multiplyScalar(g > 0 ? g : j);
        const set = g > 0 ? glow : solid;
        for (const { n, quad } of FACES) {
            if (grid.has(key(x + n[0], y + n[1], z + n[2]))) continue;
            for (const i of [0, 1, 2, 0, 2, 3]) {
                const q = quad[i];
                set.pos.push(x + q[0], y + q[1], z + q[2]);
                set.nrm.push(n[0], n[1], n[2]);
                set.col.push(rgb.r, rgb.g, rgb.b);
            }
        }
    }
    return { solid, glow };
}

function hash(x: number, y: number, z: number) {
    const h = Math.imul(x + 101, 73856093) ^ Math.imul(y + 211, 19349663) ^ Math.imul(z + 307, 83492791);
    return ((h >>> 0) % 997) / 997;
}

function mesh(f: FaceSet, mat: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(f.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(f.nrm, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(f.col, 3));
    g.scale(VOX, VOX, VOX);
    return new THREE.Mesh(g, mat);
}

/**
 * A voxel part hung from a joint: the joint sits at `at` (voxels, parent space) and the boxes
 * are shifted by `offset` (voxels) so the joint lands where the part should pivot.
 */
function part(boxes: Box[], offset: number[], at: number[], extra: THREE.MeshStandardMaterialParameters = {}) {
    const joint = new THREE.Group();
    joint.position.set(at[0] * VOX, at[1] * VOX, at[2] * VOX);
    const { solid, glow } = voxelFaces(boxes);
    for (const [f, mat] of [
        [solid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, ...extra })],
        [glow, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })],
    ] as const) {
        if (!f.pos.length) continue;
        const m = mesh(f, mat);
        m.position.set(offset[0] * VOX, offset[1] * VOX, offset[2] * VOX);
        joint.add(m);
    }
    return joint;
}

/** Ease rotation / position channels toward a target; k is the frame's blend (0 = frozen, 1 = snap). */
const to = (v: THREE.Vector3 | THREE.Euler, axis: "x" | "y" | "z", target: number, k: number) =>
    (v[axis] += (target - v[axis]) * k);
const blend = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
const shade = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();

// ---- Miner ----------------------------------------------------------------------------------------

export interface Miner extends Character {
    /** Torch lens and a point ahead of it, for the spotlight view.ts aims each frame. */
    lens: THREE.Object3D;
    aim: THREE.Object3D;
    beam: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

export function minerModel(): Miner {
    const { overalls, shirt, skin, helmet, boots, lamp } = COLORS;
    const dark = shade(overalls, 0.7),
        hair = 0x4a2e1c,
        belt = 0x5a3a22,
        steel = 0x50505a;
    const root = new THREE.Group();
    const legBoxes: Box[] = [
        [0, 0, 0, 3, 2, 2, boots],
        [0, 0, 0, 3, 1, 2, shade(boots, 0.6)],
        [0, 2, 0, 2, 4, 2, overalls],
        [0, 2, 0, 2, 1, 2, dark],
    ];
    const legs = [-1, 1].map((z) => part(legBoxes, [-1, -6, -1], [0, 6, z]));
    const torso = part(
        [
            [0, 0, 0, 4, 5, 4, overalls],
            [0, 3, 0, 4, 2, 4, shirt],
            [3, 2, 1, 1, 2, 2, overalls],
            [3, 4, 0, 1, 1, 1, overalls],
            [3, 4, 3, 1, 1, 1, overalls],
            [0, 3, 0, 1, 2, 1, overalls],
            [0, 3, 3, 1, 2, 1, overalls],
            [0, 1, 0, 4, 1, 4, belt],
            [3, 1, 1, 1, 1, 2, helmet],
        ],
        [-2, 0, -2],
        [0, 6, 0]
    );
    const armBoxes: Box[] = [
        [0, 1, 0, 2, 3, 1, shirt],
        [0, 0, 0, 2, 1, 1, skin],
    ];
    const arms = [-2.5, 2.5].map((z) => part(armBoxes, [-1, -4, -0.5], [0, 5, z]));
    const head = part(
        [
            [0, 0, 0, 4, 3, 5, skin],
            [0, 0, 0, 1, 3, 5, hair],
            [1, 1, -1, 1, 1, 1, skin],
            [1, 1, 5, 1, 1, 1, skin],
            [3, 2, 1, 1, 1, 1, 0x141420],
            [3, 2, 3, 1, 1, 1, 0x141420],
            [4, 1, 2, 1, 1, 1, shade(skin, 0.85)],
            [3, 0, 2, 1, 1, 1, shade(skin, 0.7)],
            [0, 3, 0, 4, 2, 5, helmet],
            [1, 5, 2, 2, 1, 1, shade(helmet, 0.8)],
            [4, 3, 0, 1, 1, 5, shade(helmet, 0.8)],
            // The torch: a steel housing on the helmet front, with a glowing lens.
            [4, 4, 1, 1, 1, 3, steel],
            [5, 4, 2, 1, 1, 1, lamp, 3.5 * TORCH_GLOW],
        ],
        [-2, 0, -2.5],
        [0, 5, 0],
        { metalness: 0.05 }
    );
    const lens = new THREE.Object3D();
    lens.position.set(4 * VOX, 4.5 * VOX, 0);
    const aim = new THREE.Object3D();
    aim.position.set(12 * VOX, 3 * VOX, 0);
    const beam = torchBeam();
    beam.position.copy(lens.position);
    head.add(lens, aim, beam);
    torso.add(head, ...arms);
    root.add(torso, ...legs);
    const group = new THREE.Group();
    group.add(root);

    const pose = (s: PoseState) => {
        if (s.mode === "flail") {
            const a = s.t * 28;
            arms[0].rotation.z = a;
            arms[1].rotation.z = a + Math.PI;
            legs[0].rotation.z = Math.sin(a) * 0.8;
            legs[1].rotation.z = -Math.sin(a) * 0.8;
            return;
        }
        const k = blend(s.dt, 18);
        let l0 = 0,
            l1 = 0,
            a0 = 0.05,
            a1 = 0.05,
            lean = 0,
            bob = 0,
            look = 0,
            stretch = 1;
        if (s.mode === "walk") {
            const w = Math.sin(s.phase);
            l0 = w * 0.8;
            l1 = -w * 0.8;
            a0 = -w * 0.9;
            a1 = w * 0.9;
            lean = -0.12;
            bob = Math.abs(Math.cos(s.phase)) * 0.6;
        } else if (s.mode === "idle") {
            const b = Math.sin(s.t * 2.4);
            bob = b * 0.15;
            a0 += b * 0.05;
            a1 -= b * 0.05;
            look = Math.sin(s.t * 0.6) * 0.35;
        } else if (s.mode === "rise") {
            l0 = 0.9;
            l1 = -0.5;
            a0 = 2.6;
            a1 = 2.2;
            lean = -0.1;
            stretch = 1.06;
        } else {
            const f = Math.sin(s.t * 9) * 0.25;
            l0 = 0.3;
            l1 = -0.2;
            a0 = 1.9 + f;
            a1 = 1.9 - f;
            lean = 0.08;
        }
        // Wrap arms back from a flail so they don't unwind several turns.
        for (const a of arms) a.rotation.z = Math.atan2(Math.sin(a.rotation.z), Math.cos(a.rotation.z));
        to(legs[0].rotation, "z", l0, k);
        to(legs[1].rotation, "z", l1, k);
        to(arms[0].rotation, "z", a0, k);
        to(arms[1].rotation, "z", a1, k);
        to(torso.rotation, "z", lean, k);
        to(torso.position, "y", (6 + bob) * VOX, k);
        to(head.rotation, "y", look, blend(s.dt, 4));
        root.scale.set(1 + 0.12 * s.land, (1 - 0.22 * s.land) * stretch, 1 + 0.12 * s.land);
    };
    return { group, pose, lens, aim, beam };
}

/** A soft additive cone from the lens forward: bright at the lens, fading to nothing. */
function torchBeam() {
    const len = 3.2;
    const geo = new THREE.ConeGeometry(0.9, len, 16, 6, true);
    geo.translate(0, -len / 2, 0);
    geo.rotateZ(Math.PI / 2 - 0.12);
    const p = geo.attributes.position,
        c = new THREE.Color(COLORS.lampLight),
        col: number[] = [];
    for (let i = 0; i < p.count; i++) {
        const f = Math.max(0, 1 - Math.hypot(p.getX(i), p.getY(i), p.getZ(i)) / len) ** 1.6 * 0.22;
        col.push(c.r * f, c.g * f, c.b * f);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false,
        })
    );
    m.userData.fx = true; // no shadow
    return m;
}

// ---- Guardians ------------------------------------------------------------------------------------

const EYE = COLORS.guardianEye;

export function guardianModel(kind: "walk" | "fly" | "lift", style: number, col: THREE.Color): Character {
    const c = col.getHex();
    if (kind === "lift") return drone(c);
    if (kind === "fly") return bat(c);
    return [robot, beetle, slime][style % 3](c);
}

function robot(c: number): Character {
    const dk = shade(c, 0.6),
        grey = 0x6a6a78,
        black = 0x101018;
    const legs = [-1.5, 1.5].map((z) =>
        part(
            [
                [0, 0, 0, 3, 1, 2, black],
                [0, 1, 0, 2, 3, 2, grey],
            ],
            [-1, -4, -1],
            [0, 4, z],
            { metalness: 0.5, roughness: 0.4 }
        )
    );
    const torso = part(
        [
            [0, 0, 0, 6, 5, 6, c],
            [0, 0, 0, 6, 1, 6, dk],
            [6, 2, 1, 1, 1, 4, c, 2.2],
            [6, 3, 2, 1, 1, 2, black],
        ],
        [-3, 0, -3],
        [0, 4, 0],
        { metalness: 0.5, roughness: 0.35 }
    );
    const arms = [-3.5, 3.5].map((z) =>
        part(
            [
                [0, 1, 0, 2, 3, 1, dk],
                [0, 0, 0, 2, 1, 1, grey],
            ],
            [-1, -4, -0.5],
            [0, 4.5, z],
            { metalness: 0.5, roughness: 0.4 }
        )
    );
    const head = part(
        [
            [0, 0, 0, 5, 4, 5, c],
            [5, 1, 0, 1, 2, 5, black],
            [5, 2, 1, 1, 1, 3, EYE, 3],
            [2, 4, 2, 1, 2, 1, grey],
            [2, 6, 2, 1, 1, 1, c, 3],
        ],
        [-2.5, 0, -2.5],
        [0, 5, 0],
        { metalness: 0.5, roughness: 0.35 }
    );
    torso.add(head, ...arms);
    const group = new THREE.Group();
    group.add(torso, ...legs);
    return {
        group,
        pose: (s) => {
            const w = Math.sin(s.phase);
            legs[0].rotation.z = w * 0.5;
            legs[1].rotation.z = -w * 0.5;
            arms[0].rotation.z = -w * 0.6;
            arms[1].rotation.z = w * 0.6;
            torso.position.y = (4 + Math.abs(Math.cos(s.phase)) * 0.5) * VOX;
            head.rotation.y = Math.sin(s.t * 2) * 0.3;
        },
    };
}

function beetle(c: number): Character {
    const dk = shade(c, 0.45);
    const body = part(
        [
            [0, 0, 0, 8, 2, 6, c],
            [1, 2, 1, 6, 1, 4, c],
            [2, 3, 2, 4, 1, 2, c],
            [0, 0, 0, 8, 1, 6, dk],
            [8, 0, 1, 2, 2, 4, dk],
            [9, 1, 1, 1, 1, 1, EYE, 3],
            [9, 1, 4, 1, 1, 1, EYE, 3],
            [10, 0, 1, 1, 1, 1, dk],
            [10, 0, 4, 1, 1, 1, dk],
        ],
        [-5, 0, -3],
        [0, 3, 0],
        { roughness: 0.45 }
    );
    const legs = [-3, 0, 3].flatMap((x, i) =>
        [-1, 1].map((side) => {
            // A hip bar out from the shell, then a foot down at its tip.
            const l = part(
                side > 0
                    ? [
                          [0, 2, 0, 1, 1, 2, dk],
                          [0, 0, 2, 1, 2, 1, dk],
                      ]
                    : [
                          [0, 2, -2, 1, 1, 2, dk],
                          [0, 0, -3, 1, 2, 1, dk],
                      ],
                [-0.5, -3, 0],
                [x, 3, side * 3]
            );
            l.userData.gait = (i + (side > 0 ? 1 : 0)) % 2;
            return l;
        })
    );
    const group = new THREE.Group();
    group.add(body, ...legs);
    return {
        group,
        pose: (s) => {
            for (const l of legs) l.rotation.z = Math.sin(s.phase * 1.5 + l.userData.gait * Math.PI) * 0.5;
            body.position.y = (3 + Math.abs(Math.sin(s.phase * 1.5)) * 0.4) * VOX;
        },
    };
}

function slime(c: number): Character {
    const body = part(
        [
            [0, 0, 0, 8, 2, 8, c],
            [1, 2, 1, 6, 2, 6, c],
            [2, 4, 2, 4, 1, 4, c],
            [6, 2, 2, 1, 2, 1, 0xffffff, 2],
            [6, 2, 5, 1, 2, 1, 0xffffff, 2],
            [6, 2, 3, 1, 1, 2, shade(c, 0.4)],
        ],
        [-4, 0, -4],
        [0, 0, 0],
        { transparent: true, opacity: 0.88, roughness: 0.15, emissive: c, emissiveIntensity: 0.25 }
    );
    const group = new THREE.Group();
    group.add(body);
    return {
        group,
        pose: (s) => {
            const hop = Math.abs(Math.sin(s.phase * 0.5));
            body.position.y = hop * 3 * VOX;
            body.scale.set(1.12 - 0.17 * hop, 0.8 + 0.3 * hop, 1.12 - 0.17 * hop);
        },
    };
}

function bat(c: number): Character {
    const dk = shade(c, 0.5);
    const body = part(
        [
            [0, 0, 0, 4, 4, 4, c],
            [1, 4, 0, 1, 2, 1, dk],
            [1, 4, 3, 1, 2, 1, dk],
            [3, 2, 0, 1, 1, 1, EYE, 3],
            [3, 2, 3, 1, 1, 1, EYE, 3],
            [3, 0, 1, 1, 1, 1, 0xffffff],
        ],
        [-2, 0, -2],
        [0, 6, 0],
        { roughness: 0.9 }
    );
    const wings = [-1, 1].map((side) => {
        const z = (w: number) => (side > 0 ? 0 : -w);
        return part(
            [
                [-1, 0, z(2), 4, 1, 2, dk],
                [-1, 0, side > 0 ? 2 : -4, 3, 1, 2, dk],
                [-1, 0, side > 0 ? 4 : -5, 2, 1, 1, dk],
            ],
            [0, 0, 0],
            [0, 9, side * 2]
        );
    });
    const group = new THREE.Group();
    group.add(body, ...wings);
    return {
        group,
        pose: (s) => {
            const f = Math.sin(s.t * 16) * 0.8;
            wings[0].rotation.x = f;
            wings[1].rotation.x = -f;
            const y = 6 + Math.sin(s.t * 4) * 0.8;
            body.position.y = y * VOX;
            for (const w of wings) w.position.y = (y + 3) * VOX;
        },
    };
}

function drone(c: number): Character {
    const dk = shade(c, 0.55),
        grey = 0x6a6a78;
    const core = part(
        [
            [0, 0, 0, 6, 6, 6, c],
            [0, 2, 0, 6, 1, 6, dk],
            [2, 2, 6, 2, 2, 1, EYE, 3],
            [6, 2, 2, 1, 2, 2, EYE, 3],
            [1, -1, 1, 4, 1, 4, c, 2],
            [2, 6, 2, 2, 1, 2, grey],
        ],
        [-3, 0, -3],
        [0, 5, 0],
        { metalness: 0.6, roughness: 0.3 }
    );
    const rotor = part(
        [
            [0, 0, 4, 9, 1, 1, grey],
            [4, 0, 0, 1, 1, 9, grey],
            [0, 0, 4, 1, 1, 1, c, 2.5],
            [8, 0, 4, 1, 1, 1, c, 2.5],
        ],
        [-4.5, 0, -4.5],
        [0, 7, 0]
    );
    core.add(rotor);
    const group = new THREE.Group();
    group.add(core);
    return {
        group,
        pose: (s) => {
            rotor.rotation.y = s.t * 20;
            core.position.y = (5 + Math.sin(s.t * 3) * 0.5) * VOX;
            core.rotation.z = Math.sin(s.t * 1.7) * 0.08;
            core.rotation.y = Math.sin(s.t * 0.8) * 0.4;
        },
    };
}
