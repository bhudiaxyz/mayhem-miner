/**
 * Paint — procedural canvas textures for a cavern: rock tiles and the layered back wall.
 *
 * Purpose
 *   Gives every cavern its own surfaces without image files. Everything is painted at
 *   runtime from a seed derived from the cavern's name, so a cavern always looks the same.
 *
 * Operations
 *   - seedOf(name): FNV-1a hash of a cavern name, the seed for everything below.
 *   - canvasTex(size, paint, seed): a nearest-filtered, repeating canvas texture.
 *   - rockTexture(style, seed): a 16 × 16 greyscale rock tile (tinted per block instance):
 *     mottled, strata, fractured, cobble or crystal.
 *   - backdropTextures(theme, seed): the back wall, 16 px per cell, in three layers:
 *       1. the theme gradient, quantised into flat bands (the copper-bar look);
 *       2. natural rock (theme.wall, mottled with soft patches of a second seeded style):
 *          rock, stone (boulders), rubble, marble, mud or fissured,
 *          as light / dark overlays so the gradient tints it (no masonry: these are caves);
 *       3. a feature (theme.back): bars (none), strata waves, cave stalactites, glowworm
 *          stars, hanging roots or ore veins.
 *     Returns { map, glow }: glow is an emissive map holding only what should shine
 *     (stars, veins), so it glows whatever the lighting.
 *
 * Usage
 *   render/view.ts build(): rock = rockTexture(th.rockStyle, seed); back wall material uses
 *   backdropTextures(th, seed). View disposes them when the cavern changes.
 *
 * See also: core/palette.ts (Theme), render/view.ts; DESIGN.md "11. Palette and themes".
 */
import * as THREE from "three";
import { rng } from "../core/random";
import { WALL_STYLES, type RockStyle, type Theme } from "../core/palette";

type Ctx = CanvasRenderingContext2D;

export function seedOf(name: string) {
    let h = 0x811c9dc5;
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
    return h >>> 0;
}

export function canvasTex(size: number | [number, number], paint: (g: Ctx, r: () => number) => void, seed: number) {
    const [w, h] = typeof size === "number" ? [size, size] : size;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    paint(c.getContext("2d")!, rng(seed));
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

const grey = (v: number, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;
const shade = (r: () => number, k: number) => (r() < 0.5 ? `rgba(0,0,0,${r() * k})` : `rgba(255,255,255,${r() * k})`);

function speckle(g: Ctx, r: () => number, n: number, lo: number, hi: number, size = 16) {
    for (let i = 0; i < n; i++) {
        g.fillStyle = grey(lo + r() * (hi - lo));
        g.fillRect(Math.floor(r() * size), Math.floor(r() * size), 1, 1);
    }
}

function bevel(g: Ctx) {
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(0, 0, 16, 1);
    g.fillRect(0, 0, 1, 16);
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.fillRect(0, 15, 16, 1);
    g.fillRect(15, 0, 1, 16);
}

// ---- Rock tiles (16 × 16) ---------------------------------------------------------------------------

const ROCK: Record<RockStyle, (g: Ctx, r: () => number) => void> = {
    mottled: (g, r) => {
        g.fillStyle = grey(200);
        g.fillRect(0, 0, 16, 16);
        for (let i = 0; i < 14; i++) {
            g.fillStyle = grey(140 + r() * 90);
            g.fillRect(Math.floor(r() * 15), Math.floor(r() * 15), 2, 2);
        }
        speckle(g, r, 50, 150, 235);
    },
    strata: (g, r) => {
        for (let y = 0; y < 16;) {
            const h = 2 + Math.floor(r() * 3);
            g.fillStyle = grey(150 + r() * 90);
            g.fillRect(0, y, 16, h);
            // A wobble: the band edge steps up or down a pixel here and there.
            g.fillStyle = grey(130 + r() * 60);
            for (let x = 0; x < 16; x += 3 + Math.floor(r() * 4)) g.fillRect(x, y, 2, 1);
            y += h;
        }
        speckle(g, r, 25, 120, 230);
    },
    fractured: (g, r) => {
        // Angular shards: each pixel takes the shade of its nearest seed; edges between shards darken.
        const seeds = Array.from({ length: 6 }, () => [r() * 16, r() * 16, 150 + r() * 90]);
        const near = (x: number, y: number) => {
            let best = 0,
                d0 = Infinity;
            seeds.forEach(([sx, sy], i) => {
                // Wrapped distance so the tile repeats seamlessly.
                const dx = Math.min(Math.abs(x - sx), 16 - Math.abs(x - sx)),
                    dy = Math.min(Math.abs(y - sy), 16 - Math.abs(y - sy)),
                    d = dx * dx + dy * dy;
                if (d < d0) ((d0 = d), (best = i));
            });
            return best;
        };
        for (let y = 0; y < 16; y++)
            for (let x = 0; x < 16; x++) {
                const i = near(x, y);
                const edge = near(x + 1, y) !== i || near(x, y + 1) !== i;
                g.fillStyle = grey(edge ? seeds[i][2] * 0.55 : seeds[i][2]);
                g.fillRect(x, y, 1, 1);
            }
    },
    cobble: (g, r) => {
        g.fillStyle = grey(90);
        g.fillRect(0, 0, 16, 16);
        for (let i = 0; i < 7; i++) {
            const x = r() * 16,
                y = r() * 16,
                rad = 2.5 + r() * 2.5;
            g.fillStyle = grey(160 + r() * 80);
            g.beginPath();
            g.ellipse(x, y, rad, rad * (0.7 + r() * 0.3), r() * 3, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = "rgba(255,255,255,0.25)";
            g.fillRect(Math.floor(x - rad / 2), Math.floor(y - rad / 2), 2, 1);
        }
    },
    crystal: (g, r) => {
        g.fillStyle = grey(130);
        g.fillRect(0, 0, 16, 16);
        // Facets: bright diagonal streaks of varying length, then a couple of glints.
        for (let i = 0; i < 6; i++) {
            const x = Math.floor(r() * 16),
                y = Math.floor(r() * 16),
                len = 3 + Math.floor(r() * 6),
                v = 180 + r() * 75;
            for (let k = 0; k < len; k++) {
                g.fillStyle = grey(v - k * 6);
                g.fillRect((x + k) % 16, (y + k) % 16, 1, 1);
                g.fillStyle = grey(v * 0.7);
                g.fillRect((x + k + 1) % 16, (y + k) % 16, 1, 1);
            }
        }
        speckle(g, r, 4, 250, 255);
    },
};

export function rockTexture(style: RockStyle, seed: number) {
    return canvasTex(16, (g, r) => (ROCK[style](g, r), bevel(g)), seed);
}

// ---- Back wall (32 × 16 cells at 16 px a cell) ------------------------------------------------------

const BW = 512,
    BH = 256;
/** How strongly the rock pattern and features show over the gradient (1 = full strength). */
const BACKDROP_DETAIL = 0.45;
/** Saturation of the back-wall gradient (1 = the theme's colours as written). */
const BACKDROP_SATURATION = 0.65;

/** Light or dark overlay of strength k (k < 0 darkens). */
const tone = (k: number) => (k < 0 ? `rgba(0,0,0,${-k})` : `rgba(255,255,255,${k})`);

function wall(g: Ctx, r: () => number, style: Theme["wall"]) {
    if (style === "stone") {
        // Natural stone: irregular boulders (Voronoi cells on a 4 px grid, so it stays blocky)
        // with dark seams between them and a lit upper edge on each.
        const C = 4,
            cols = BW / C,
            rows = BH / C;
        const seeds = Array.from({ length: 170 }, () => [r() * cols, r() * rows, (r() - 0.5) * 0.24]);
        const cell = new Int16Array(cols * rows);
        for (let y = 0; y < rows; y++)
            for (let x = 0; x < cols; x++) {
                let best = 0,
                    d0 = Infinity;
                for (let i = 0; i < seeds.length; i++) {
                    const dx = x - seeds[i][0],
                        dy = (y - seeds[i][1]) * 1.4;
                    const d = dx * dx + dy * dy;
                    if (d < d0) ((d0 = d), (best = i));
                }
                cell[y * cols + x] = best;
            }
        for (let y = 0; y < rows; y++)
            for (let x = 0; x < cols; x++) {
                const i = cell[y * cols + x];
                const seam =
                    (x + 1 < cols && cell[y * cols + x + 1] !== i) || (y + 1 < rows && cell[(y + 1) * cols + x] !== i);
                const lip = y > 0 && cell[(y - 1) * cols + x] !== i;
                g.fillStyle = seam
                    ? tone(-0.4)
                    : lip
                      ? tone(0.1)
                      : tone(seeds[i][2] < 0 ? seeds[i][2] : seeds[i][2] * 0.6);
                g.fillRect(x * C, y * C, C, C);
            }
    } else if (style === "marble") {
        // Smooth, cloudy rock with wandering, occasionally forking light veins.
        for (let i = 0; i < 60; i++) {
            const x = r() * BW,
                y = r() * BH,
                rad = 20 + r() * 50;
            const grad = g.createRadialGradient(x, y, 0, x, y, rad);
            grad.addColorStop(0, r() < 0.5 ? tone(0.06) : tone(-0.1));
            grad.addColorStop(1, "rgba(0,0,0,0)");
            g.fillStyle = grad;
            g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        }
        for (let i = 0; i < 16; i++) {
            let x = r() * BW,
                y = r() * BH,
                a = r() * Math.PI * 2;
            const len = 60 + r() * 160;
            g.fillStyle = tone(0.06 + r() * 0.1);
            for (let k = 0; k < len; k++) {
                a += (r() - 0.5) * 0.5;
                x += Math.cos(a);
                y += Math.sin(a);
                g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
                if (r() < 0.01) a += (r() - 0.5) * 2;
            }
        }
    } else if (style === "rubble") {
        g.fillStyle = tone(-0.25);
        g.fillRect(0, 0, BW, BH);
        for (let i = 0; i < 900; i++) {
            const x = r() * BW,
                y = r() * BH,
                rad = 3 + r() * 6;
            g.fillStyle = shade(r, 0.16);
            g.beginPath();
            g.ellipse(x, y, rad, rad * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = tone(0.08);
            g.fillRect(Math.floor(x - rad / 2), Math.floor(y - rad / 2), Math.ceil(rad), 1);
        }
    } else if (style === "mud") {
        // Packed mud: dark, soft blotches, seep streaks running down, and embedded pebbles.
        g.fillStyle = "rgba(20,10,0,0.3)";
        g.fillRect(0, 0, BW, BH);
        for (let i = 0; i < 300; i++) {
            g.fillStyle = shade(r, 0.08);
            g.beginPath();
            g.ellipse(r() * BW, r() * BH, 6 + r() * 18, 3 + r() * 8, 0, 0, Math.PI * 2);
            g.fill();
        }
        g.fillStyle = tone(-0.18);
        for (let i = 0; i < 70; i++)
            g.fillRect(Math.floor(r() * BW), Math.floor(r() * BH), 2, 10 + Math.floor(r() * 40));
        for (let i = 0; i < 160; i++) {
            const x = Math.floor(r() * BW),
                y = Math.floor(r() * BH);
            g.fillStyle = tone(0.12);
            g.fillRect(x, y, 2, 2);
            g.fillStyle = tone(-0.3);
            g.fillRect(x, y + 2, 2, 1);
        }
    } else if (style === "fissured") {
        // Solid rock split by long cracks, each with a faint lit lip.
        for (let i = 0; i < 300; i++) {
            g.fillStyle = shade(r, 0.08);
            g.fillRect(Math.floor(r() * BW), Math.floor(r() * BH), 4 + Math.floor(r() * 12), 3 + Math.floor(r() * 8));
        }
        for (let i = 0; i < 18; i++) {
            let x = r() * BW,
                y = r() * BH,
                a = r() * Math.PI * 2;
            for (let k = 0, len = 40 + r() * 140; k < len; k++) {
                a += (r() - 0.5) * 0.9;
                x += Math.cos(a) * 1.5;
                y += Math.sin(a) * 1.5;
                g.fillStyle = tone(-0.32);
                g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
                g.fillStyle = tone(0.06);
                g.fillRect(Math.floor(x), Math.floor(y) - 1, 1, 1);
            }
        }
    } else {
        // Rock: rough-hewn blotches and short chisel marks.
        for (let i = 0; i < 500; i++) {
            g.fillStyle = shade(r, 0.1);
            g.fillRect(Math.floor(r() * BW), Math.floor(r() * BH), 2 + Math.floor(r() * 8), 2 + Math.floor(r() * 6));
        }
        g.fillStyle = tone(-0.22);
        for (let i = 0; i < 260; i++)
            g.fillRect(Math.floor(r() * BW), Math.floor(r() * BH), 3 + Math.floor(r() * 6), 1);
    }
}

function crack(g: Ctx, r: () => number, x: number, y: number, len: number) {
    g.fillStyle = "rgba(0,0,0,0.4)";
    for (let k = 0; k < len; k++) {
        x += (r() - 0.5) * 2;
        y += 1;
        g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
}

function feature(g: Ctx, glow: Ctx, r: () => number, th: Theme) {
    const accent = `#${new THREE.Color(th.mote).getHexString()}`;
    const vein = `#${new THREE.Color(th.glow).getHexString()}`;
    if (th.back === "strata") {
        // Wavy sediment layers across the whole wall.
        for (let k = 0; k < 9; k++) {
            const y0 = (k + r()) * (BH / 9),
                amp = 3 + r() * 8,
                f = 0.01 + r() * 0.02,
                ph = r() * 6;
            g.fillStyle = k % 2 ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.06)";
            g.beginPath();
            g.moveTo(0, BH);
            for (let x = 0; x <= BW; x += 8) g.lineTo(x, y0 + Math.sin(x * f + ph) * amp);
            g.lineTo(BW, BH);
            g.fill();
        }
    } else if (th.back === "cave") {
        // Stalactites from the ceiling, stalagmites from the floor (dark silhouettes).
        g.fillStyle = "rgba(0,0,0,0.42)";
        for (let x = 0; x < BW; x += 6 + r() * 18) {
            const w = 6 + r() * 14,
                h = 10 + r() * 50;
            g.beginPath();
            g.moveTo(x, 16);
            g.lineTo(x + w / 2, 16 + h);
            g.lineTo(x + w, 16);
            g.fill();
            if (r() < 0.5) {
                const h2 = 6 + r() * 26;
                g.beginPath();
                g.moveTo(x, BH - 16);
                g.lineTo(x + w / 2, BH - 16 - h2);
                g.lineTo(x + w, BH - 16);
                g.fill();
            }
        }
    } else if (th.back === "stars") {
        g.fillStyle = "rgba(0,0,0,0.3)";
        g.fillRect(0, 0, BW, BH);
        // Glowworms: clusters of tiny lights, brighter toward the ceiling.
        for (let c = 0; c < 22; c++) {
            const cx = r() * BW,
                cy = 16 + r() * r() * (BH - 32);
            for (let i = 0; i < 12; i++) {
                const x = Math.floor(cx + (r() - 0.5) * 60),
                    y = Math.floor(cy + (r() - 0.5) * 30),
                    s = r() < 0.2 ? 2 : 1;
                for (const ctx of [g, glow]) {
                    ctx.fillStyle = accent;
                    ctx.globalAlpha = 0.5 + r() * 0.5;
                    ctx.fillRect(x, y, s, s);
                }
            }
        }
        g.globalAlpha = glow.globalAlpha = 1;
    } else if (th.back === "roots") {
        // Roots hanging from the ceiling: wavering strands that fork and taper as they go down.
        const strand = (x: number, y: number, len: number, w: number) => {
            let a = Math.PI / 2;
            for (let k = 0; k < len; k++) {
                a += (r() - 0.5) * 0.25 + (Math.PI / 2 - a) * 0.05;
                x += Math.cos(a);
                y += Math.sin(a);
                g.fillStyle = "rgba(30,16,6,0.4)";
                g.fillRect(Math.floor(x), Math.floor(y), Math.max(1, Math.round(w * (1 - k / len))), 1);
                if (w > 1.5 && r() < 0.012) strand(x, y, (len - k) * 0.6, w * 0.6);
            }
        };
        for (let x = r() * 30; x < BW; x += 20 + r() * 50) strand(x, 16, 30 + r() * 110, 2 + r() * 3);
    } else if (th.back === "veins") {
        // Ore veins: jagged glowing seams with nuggets along them.
        for (let i = 0; i < 7; i++) {
            let x = r() * BW,
                y = 16 + r() * (BH - 32),
                a = (r() - 0.5) * 1.2;
            const len = 80 + r() * 200;
            for (let k = 0; k < len; k++) {
                a += (r() - 0.5) * 0.6;
                x += Math.cos(a) * 1.5;
                y += Math.sin(a);
                const s = r() < 0.06 ? 3 : 2;
                for (const ctx of [g, glow]) {
                    ctx.fillStyle = vein;
                    ctx.globalAlpha = ctx === g ? 0.4 : 0.2;
                    ctx.fillRect(Math.floor(x), Math.floor(y), s, s);
                }
            }
        }
        g.globalAlpha = glow.globalAlpha = 1;
    }
}

export function backdropTextures(th: Theme, seed: number) {
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = BW;
    glowCanvas.height = BH;
    const glow = glowCanvas.getContext("2d")!;
    glow.fillStyle = "#000";
    glow.fillRect(0, 0, BW, BH);
    const map = canvasTex(
        [BW, BH],
        (g, r) => {
            const grad = g.createLinearGradient(0, 0, 0, BH);
            th.bars.forEach((s, i) => grad.addColorStop(i / (th.bars.length - 1), s));
            g.fillStyle = grad;
            g.fillRect(0, 0, BW, BH);
            // Quantise into flat bands (the copper-list look), desaturated so the wall stays calm.
            const img = g.getImageData(0, 0, 1, BH).data;
            for (let y = 0; y < BH; y += 8) {
                const [R, G, B] = [img[y * 4], img[y * 4 + 1], img[y * 4 + 2]];
                const l = 0.3 * R + 0.59 * G + 0.11 * B;
                const mix = (c: number) => Math.round(l + (c - l) * BACKDROP_SATURATION);
                g.fillStyle = `rgb(${mix(R)},${mix(G)},${mix(B)})`;
                g.fillRect(0, y, BW, 8);
            }
            // Rock and features go on their own layer, blended in softly: the wall is a backdrop,
            // and the level in front of it must always stand out.
            const canvas = () => {
                const c = document.createElement("canvas");
                c.width = BW;
                c.height = BH;
                return [c, c.getContext("2d")!] as const;
            };
            const [layer, lg] = canvas();
            wall(lg, r, th.wall);
            // A mottled mix: soft patches of a second rock style (seeded) blended into the first.
            const others = WALL_STYLES.filter((w) => w !== th.wall);
            const [patch, pg] = canvas();
            wall(pg, r, others[Math.floor(r() * others.length)]);
            const [mask, mg] = canvas();
            for (let i = 0; i < 9; i++) {
                const x = r() * BW,
                    y = r() * BH,
                    rad = 40 + r() * 90;
                const m = mg.createRadialGradient(x, y, 0, x, y, rad);
                m.addColorStop(0, "rgba(0,0,0,1)");
                m.addColorStop(1, "rgba(0,0,0,0)");
                mg.fillStyle = m;
                mg.fillRect(x - rad, y - rad, rad * 2, rad * 2);
            }
            pg.globalCompositeOperation = "destination-in";
            pg.drawImage(mask, 0, 0);
            lg.drawImage(patch, 0, 0);
            feature(lg, glow, r, th);
            g.globalAlpha = BACKDROP_DETAIL;
            g.drawImage(layer, 0, 0);
            g.globalAlpha = 1;
        },
        seed
    );
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    glowTex.magFilter = THREE.NearestFilter;
    glowTex.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    return { map, glow: glowTex };
}
