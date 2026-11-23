/**
 * Props — shared prop geometry, and small animated dioramas of each obstacle for How to play.
 *
 * Purpose
 *   One source for the shapes the caverns use, so Help's previews look exactly like the game.
 *
 * Operations
 *   - crumbleGeometry(): a crumbling ledge cell, the slab broken into four uneven voxel chunks
 *     with gaps and crumbs hanging below (a plain ledge is one solid slab).
 *   - crumbleStripGeometry(): its broken glow strip (three dashes).
 *   - propModel(id): a diorama for How to play, posed like a Character (render/preview.ts):
 *       crystal  spins and flashes through the crystal colours
 *       portal   dark, then lit and pulsing, on a loop
 *       crumble  two cells that shake, sink and fall away in turn, then reset
 *       belt     a conveyor whose chevrons scroll
 *       spikes   a floor of spikes with pulsing red tips
 *       door     a lever that flips and a door that opens, on a loop
 *   - PROPS: the ids above, in Help order; HAZARDS: Help's text for each (name, tag line,
 *     description), with "from cavern N" read from the hand-built maps.
 *
 * Usage
 *   render/view.ts uses the geometry; render/preview.ts calls propModel for Help.
 *
 * See also: render/view.ts (build), render/paint.ts (tileTextures); DESIGN.md "10.1 Screens".
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { COLORS, hdr, THEMES } from "../core/palette";
import { rng } from "../core/random";
import { CAVERNS } from "../world/caverns";
import type { Character } from "./characters";
import { rockTexture, tileTextures } from "./paint";

/** Block depth (z), as in render/view.ts. */
const DEPTH = 1.2;

export function crumbleGeometry() {
    const r = rng(9301);
    const parts: THREE.BufferGeometry[] = [];
    const n = 4,
        gap = 0.035,
        w = (1 - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
        const h = 0.24 + r() * 0.1;
        const g = new THREE.BoxGeometry(w, h, DEPTH * (0.9 + r() * 0.1));
        g.translate(-0.5 + w / 2 + i * (w + gap), 0.16 - h / 2 - r() * 0.03, (r() - 0.5) * 0.06);
        parts.push(g);
    }
    for (let i = 0; i < 3; i++) {
        const s = 0.06 + r() * 0.04;
        const g = new THREE.BoxGeometry(s, s, s);
        g.translate(-0.35 + r() * 0.7, -0.2 - r() * 0.06, (r() - 0.5) * DEPTH * 0.6);
        parts.push(g);
    }
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    return merged;
}

export function crumbleStripGeometry() {
    return mergeGeometries([-0.33, 0, 0.33].map((x) => new THREE.BoxGeometry(0.22, 0.05, 0.05).translate(x, 0, 0)));
}

// ---- Help dioramas ---------------------------------------------------------------------------------
// Each stands on the origin, about two cells wide, like a character, so the preview camera fits both.

export const PROPS = ["crystal", "portal", "crumble", "belt", "spikes", "door"] as const;
export type PropId = (typeof PROPS)[number];

/** The first hand-built cavern (1-based) with a feature, read from the maps so it stays true. */
const firstWith = (has: (cv: (typeof CAVERNS)[number]) => boolean) => `from cavern ${CAVERNS.findIndex(has) + 1}`;

/** Help's "Obstacles & dangers": each prop's name, tag line and description, in PROPS order. */
export const HAZARDS: { id: PropId; name: string; meta: string; blurb: string }[] = [
    {
        id: "crystal",
        name: "Crystal",
        meta: "collect every one",
        blurb: "They flash through colours. Take them all to light the portal; each one scores 100.",
    },
    {
        id: "portal",
        name: "Portal",
        meta: "the way out",
        blurb: "Dark until the last crystal is taken, then it lights up and pulses. Walk in: air left over is paid as bonus points.",
    },
    {
        id: "crumble",
        name: "Crumbling ledge",
        meta: firstWith((cv) => cv.tiles.includes("~")),
        blurb: "Broken, gritty and dimly edged. It holds you for under a second, then sinks and falls away. Keep moving.",
    },
    {
        id: "belt",
        name: "Conveyor belt",
        meta: firstWith((cv) => /[<>]/.test(cv.tiles)),
        blurb: "Its chevrons scroll the way it carries you. You can't walk against it, but you can jump off it.",
    },
    {
        id: "spikes",
        name: "Spikes",
        meta: firstWith((cv) => cv.tiles.includes("^")),
        blurb: "Deadly to touch, on floors, ledges and ceilings, though forgiving at their very edges.",
    },
    {
        id: "door",
        name: "Sealed door & lever",
        meta: firstWith((cv) => cv.levers.length > 0),
        blurb: "Doors are solid until you touch the lever. One lever opens every door in the cavern.",
    },
];

const TH = THEMES[0];
const tint = (hex: number) => new THREE.Color(hex);

export function propModel(id: PropId): Character {
    const tex = tileTextures();
    const group = new THREE.Group();
    const glowStrip = (x: number, y: number) => {
        const m = new THREE.Mesh(
            new THREE.BoxGeometry(1.02, 0.05, 0.05),
            new THREE.MeshBasicMaterial({ color: hdr(TH.glow, 1.05), toneMapped: false })
        );
        m.position.set(x, y, DEPTH / 2 + 0.02);
        return m;
    };
    const rock = (x: number, y: number) => {
        const t = rockTexture(TH.rockStyle, 4242);
        const m = new THREE.Mesh(
            new RoundedBoxGeometry(1, 1, DEPTH, 2, 0.05),
            new THREE.MeshStandardMaterial({ map: t, bumpMap: t, color: tint(TH.rock), roughness: 0.9 })
        );
        m.position.set(x, y, 0);
        return m;
    };

    if (id === "crystal") {
        const m = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.42),
            new THREE.MeshBasicMaterial({ toneMapped: false })
        );
        m.scale.y = 1.35;
        group.add(m);
        const cyc = COLORS.crystalCycle;
        return {
            group,
            pose: (s) => {
                m.rotation.y = s.t * 2;
                m.position.y = 1 + Math.sin(s.t * 3) * 0.08;
                m.material.color.copy(hdr(cyc[Math.floor(s.t * 8) % cyc.length], 2));
            },
        };
    }

    if (id === "portal") {
        const frame = new THREE.MeshBasicMaterial({ toneMapped: false });
        const core = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.9 });
        for (const [x, y, w, h] of [
            [0, 0.92, 2, 0.16],
            [0, -0.92, 2, 0.16],
            [-0.92, 0, 0.16, 2],
            [0.92, 0, 0.16, 2],
        ]) {
            const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.3), frame);
            b.position.set(x, y + 1, 0);
            group.add(b);
        }
        const inner = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), core);
        inner.position.set(0, 1, -0.05);
        group.add(inner);
        group.scale.setScalar(0.8);
        return {
            group,
            pose: (s) => {
                const open = s.t % 4 > 1.6;
                const k = 0.5 + 0.5 * Math.sin(s.t * 10);
                frame.color.copy(open ? hdr(TH.glow, 1.4 + k) : tint(COLORS.portalClosed));
                core.color.copy(
                    open ? hdr(COLORS.crystalCycle[Math.floor(s.t * 6) % 5], 0.6 + 0.6 * k) : tint(0x0a0810)
                );
            },
        };
    }

    if (id === "crumble") {
        const mat = new THREE.MeshStandardMaterial({
            map: tex.crumble,
            bumpMap: tex.crumble,
            bumpScale: 2,
            roughness: 1,
            color: tint(TH.crumble),
        });
        const stripMat = new THREE.MeshBasicMaterial({ color: hdr(TH.glow, 1.05 * 0.55), toneMapped: false });
        const cells = [-0.5, 0.5].map((x) => {
            const slab = new THREE.Mesh(crumbleGeometry(), mat);
            const strip = new THREE.Mesh(crumbleStripGeometry(), stripMat);
            group.add(slab, strip);
            return { x, slab, strip };
        });
        return {
            group,
            pose: (s) => {
                // Each cell wears out in turn (as in play: sink, thin, shake), then the pair resets.
                const cyc = s.t % 3.2;
                cells.forEach(({ x, slab, strip }, i) => {
                    const w = Math.min(1, Math.max(0, (cyc - 0.4 - i * 0.9) / 0.9));
                    const sc = w >= 1 ? 0 : 1 - 0.8 * w;
                    const shake = w > 0 && w < 1 ? (Math.random() - 0.5) * 0.06 : 0;
                    slab.visible = strip.visible = sc > 0;
                    slab.scale.y = Math.max(0.01, sc);
                    slab.position.set(x + shake, 0.84 - w * 0.25, 0);
                    strip.position.set(x + shake, 1.01 - w * 0.25 - 0.16 * (1 - sc), DEPTH / 2 + 0.02);
                });
            },
        };
    }

    if (id === "belt") {
        const map = tex.belt;
        const mat = new THREE.MeshStandardMaterial({
            map,
            bumpMap: map,
            roughness: 0.5,
            metalness: 0.3,
            color: tint(TH.belt),
        });
        for (const x of [-0.5, 0.5]) {
            const m = new THREE.Mesh(new RoundedBoxGeometry(1, 0.32, DEPTH, 2, 0.04), mat);
            m.position.set(x, 0.84, 0);
            group.add(m, glowStrip(x, 1.01));
        }
        return { group, pose: (s) => (map.offset.x -= s.dt * 1.2) };
    }

    if (id === "spikes") {
        group.add(rock(-0.5, 0.5), rock(0.5, 0.5), glowStrip(-0.5, 1.01), glowStrip(0.5, 1.01));
        const mat = new THREE.MeshStandardMaterial({
            color: COLORS.spike,
            metalness: 0.6,
            roughness: 0.3,
            emissive: COLORS.spikeTip,
            emissiveIntensity: 0.35,
        });
        for (const x of [-0.72, -0.28, 0.28, 0.72]) {
            const c = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.72, 5), mat);
            c.position.set(x, 1.36, 0);
            group.add(c);
        }
        return { group, pose: (s) => (mat.emissiveIntensity = 0.3 + 0.25 * (0.5 + 0.5 * Math.sin(s.t * 4))) };
    }

    // Door and lever: the lever flips, the door opens; then it all resets.
    const floor = new THREE.Mesh(
        new RoundedBoxGeometry(2, 0.32, DEPTH, 2, 0.04),
        new THREE.MeshStandardMaterial({ map: tex.ledge, bumpMap: tex.ledge, roughness: 0.8, color: tint(TH.ledge) })
    );
    floor.position.y = 0.16;
    const door = new THREE.Mesh(
        new RoundedBoxGeometry(0.9, 1.6, DEPTH, 2, 0.05),
        new THREE.MeshStandardMaterial({
            map: tex.door,
            bumpMap: tex.door,
            emissive: COLORS.doorGlow,
            emissiveIntensity: 0.25,
            color: COLORS.door,
        })
    );
    door.position.set(0.5, 1.12, 0);
    const lever = new THREE.Group();
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
    lever.add(
        new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.4), new THREE.MeshStandardMaterial({ color: 0x404050 })),
        arm
    );
    lever.position.set(-0.55, 0.4, 0);
    group.add(floor, door, lever, glowStrip(-0.5, 0.33), glowStrip(0.5, 0.33));
    return {
        group,
        pose: (s) => {
            const open = s.t % 3.5 > 1.5;
            arm.rotation.z += ((open ? -0.6 : 0.6) - arm.rotation.z) * Math.min(1, s.dt * 10);
            door.visible = !open;
        },
    };
}
