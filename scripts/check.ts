/**
 * check — headless asserts over the pure core (npm run check).
 *
 * Purpose
 *   Proves the content is completable and the rules behave, without a browser. Runs under
 *   Node's native TypeScript support with scripts/ts-resolve.mjs for extensionless imports.
 *
 * Operations
 *   1. Every hand-built cavern parses to 32 × 16, has a start on solid ground, a portal and
 *      crystals, no guardian patrolling the start, and the solver reaches every crystal, every
 *      lever and the portal.
 *   2. Generated caverns 20..109 have at least five crystals and solve. The difficulty curve
 *      never eases cavern to cavern, saturates at 100, keeps band 1 gentle and steps up each
 *      band; fliers arrive at 31 and sprinters at 41, never before.
 *   3. Movement: the jump rises 26 px and lands where it started; a six-cell drop is survived
 *      and an eight-cell drop kills; conveyors carry; walking against a belt holds still.
 *   4. Rules: crystals score and open the portal; the portal completes the cavern and air
 *      becomes bonus; crumbling ledges give way; levers open doors; spikes and guardians kill;
 *      running out of air kills; lives run out into game over; extra life at 10,000.
 *   5. Voxel characters: the face builder emits only air-facing faces.
 *   6. GPU tiers on real devices' renderer strings (Galaxy S22 Ultra, iPad / iPhone, 2019
 *      phones, Intel / NVIDIA / Apple laptops, software GL); the governor degrades only on
 *      sustained slow frames (not iOS Low Power Mode's 30 fps) and stops when out of steps.
 *
 * Usage
 *   npm run check (exits non-zero on the first failure).
 *
 * See also: world/solver.ts, core/physics.ts, core/game.ts; DESIGN.md "15. Checks and tooling".
 */
import assert from "node:assert/strict";
import { CAVERNS, H, W, parse } from "../src/world/caverns";
import { generate } from "../src/world/generate";
import { solve } from "../src/world/solver";
import { Game } from "../src/core/game";
import { stepBody, type Body } from "../src/core/physics";
import { voxelFaces } from "../src/render/characters";
import { classifyGpu, Governor, type Tier } from "../src/render/tier";
import { difficulty, MAX_DIFFICULTY_AT, type Difficulty } from "../src/core/difficulty";

const idle = { left: false, right: false, jump: false };
const left = { left: true, right: false, jump: false };
const right = { left: false, right: true, jump: false };
const jump = { left: false, right: false, jump: true };

// 1. Hand-built caverns.
assert.equal(CAVERNS.length, 20);
for (const cv of CAVERNS) {
    const t0 = performance.now();
    assert.equal(cv.tiles.length, W * H, cv.name);
    assert.ok(cv.crystals.length >= 5, `${cv.name}: too few crystals`);
    assert.ok("#=~<>".includes(cv.tiles[(cv.start.r + 1) * W + cv.start.c]), `${cv.name}: start not on ground`);
    const s = solve(cv);
    const miss = cv.crystals.filter((_, i) => !s.crystals[i]);
    assert.deepEqual(miss, [], `${cv.name}: unreachable crystals (c, r)`);
    if (cv.levers.length) assert.ok(s.lever, `${cv.name}: lever unreachable`);
    assert.ok(s.portal, `${cv.name}: portal unreachable`);
    // Spawn safety: no guardian's sweep comes within two cells of the start.
    const sx = cv.start.c * 8,
        sy = (cv.start.r - 1) * 8;
    for (const g of cv.guardians) {
        const lift = g.kind === "lift";
        const [x0, x1] = lift ? [g.x, g.x + 8] : [g.min, g.max + 8];
        const [y0, y1] = lift ? [g.min, g.max + 16] : [g.y, g.y + 16];
        assert.ok(
            x1 <= sx - 16 || x0 >= sx + 24 || y1 <= sy || y0 >= sy + 16,
            `${cv.name}: a guardian patrols the start`
        );
    }
    console.log(
        `  ${String(cv.n + 1).padStart(2)} ${cv.name.padEnd(18)} ${cv.crystals.length} crystals, ${cv.guardians.length} guardians, ${s.states} states, ${(performance.now() - t0).toFixed(0)} ms`
    );
}

// 2. Generated caverns.
{
    const t0 = performance.now();
    for (let n = 20; n < 110; n++) {
        const cv = generate(n);
        assert.ok(cv.crystals.length >= 5);
        assert.ok(solve(cv).portal);
        assert.equal(parse({ name: cv.name, rows: rowsOf(cv.tiles) }, n).tiles.length, W * H);
    }
    console.log(`  generated 20-109 in ${(performance.now() - t0).toFixed(0)} ms (incl. re-solve)`);
}

// 2b. The difficulty curve: bands of ten, never easing, saturating at cavern 100.
{
    const harder: (keyof Difficulty)[] = [
        "t",
        "guardianSpeed",
        "crystals",
        "walkers",
        "lifts",
        "fliers",
        "sprinters",
        "crumble",
        "conveyor",
        "floorSpikes",
        "ledgeSpikes",
        "pillars",
    ];
    const easier: (keyof Difficulty)[] = ["air", "airBonus"];
    for (let n = 1; n < MAX_DIFFICULTY_AT + 10; n++) {
        const a = difficulty(n - 1),
            b = difficulty(n);
        for (const k of harder) assert.ok(b[k] >= a[k], `${k} eased at cavern ${n + 1}`);
        for (const k of easier) assert.ok(b[k] <= a[k], `${k} eased at cavern ${n + 1}`);
    }
    assert.deepEqual(difficulty(MAX_DIFFICULTY_AT - 1), difficulty(MAX_DIFFICULTY_AT + 20), "saturates at 100");
    assert.ok(difficulty(0).guardianSpeed < 0.55 && difficulty(9).t < 0.03, "band 1 stays gentle");
    const step = difficulty(10).t - difficulty(9).t,
        creep = difficulty(9).t - difficulty(8).t;
    assert.ok(step > 4 * creep, "each band is a clear step up");
    assert.equal(difficulty(0).band, 1);
    assert.equal(difficulty(10).band, 2);
    // New mechanics arrive band by band in generated caverns: fliers from 31, sprinters from 41.
    const flies = (n: number) => generate(n).guardians.some((gd) => gd.kind === "fly");
    const sprints = (n: number) => generate(n).guardians.some((gd) => (gd.speed ?? 1) > 1);
    for (let n = 20; n < 30; n++) assert.ok(!flies(n), `no fliers before cavern 31 (${n + 1})`);
    for (let n = 20; n < 40; n++) assert.ok(!sprints(n), `no sprinters before cavern 41 (${n + 1})`);
    assert.ok([30, 31, 32, 33, 34].some(flies), "fliers appear in band 4");
    assert.ok([40, 41, 42, 43, 44].some(sprints), "sprinters appear in band 5");
}

// 3. Movement.
{
    const rows = Array(14).fill("");
    rows[13] = "...>>>>>";
    rows[6] = "..............=====";
    const t = parse({ name: "lab", rows }, 0).tiles.split("");
    const b: Body = { x: 80, y: 104, mode: "ground", t: 0, dir: 0, apex: 104, face: 1 };
    stepBody(b, jump, t);
    let top = b.y;
    for (let i = 0; i < 40 && b.mode !== "ground"; i++) (stepBody(b, idle, t), (top = Math.min(top, b.y)));
    assert.equal(104 - top, 26, "jump height");
    assert.equal(b.y, 104, "jump lands where it started");
    // Conveyor at cols 4..8 (map) pushes right; walking left holds still.
    const c: Body = { x: 40, y: 96, mode: "ground", t: 0, dir: 0, apex: 96, face: 1 };
    stepBody(c, idle, t);
    assert.equal(c.x, 41, "belt carries");
    stepBody(c, left, t);
    assert.equal(c.x, 41, "walking against the belt holds still");
    // Ledge at row 7 (feet y = 56) cols 15..19: walk off its end and fall 7 cells → dead.
    const d: Body = { x: 152, y: 40, mode: "ground", t: 0, dir: 0, apex: 40, face: 1 };
    let r = "";
    for (let i = 0; i < 200 && r !== "dead" && !(r === "land" && d.y > 100); i++) r = stepBody(d, right, t);
    assert.equal(r, "dead", "eight-cell fall kills");
}
{
    const rows = Array(14).fill("");
    rows[8] = "..............=====";
    const t = parse({ name: "lab", rows }, 0).tiles.split("");
    const d: Body = { x: 152, y: 56, mode: "ground", t: 0, dir: 0, apex: 56, face: 1 };
    let r = "";
    for (let i = 0; i < 200 && r !== "dead" && !(r === "land" && d.y > 100); i++) r = stepBody(d, right, t);
    assert.equal(r, "land", "six-cell fall is survived");
}

// 4. Rules, on a small lab cavern.
function lab(rows: string[]) {
    const all = Array(14).fill("");
    rows.forEach((r, i) => (all[14 - rows.length + i] = r));
    const cv = parse({ name: "lab", rows: all }, 0);
    const g = new Game(0);
    g.load(0, cv);
    const events: string[] = [];
    g.onEvent = (e) => events.push(e);
    return {
        g,
        events,
        run: (inp: typeof idle, ticks: number) => {
            for (let i = 0; i < ticks; i++) g.tick(inp);
        },
    };
}
{
    const { g, events, run } = lab([".S..*.*...........P"]);
    run(right, 60);
    assert.equal(g.score, 200, "two crystals");
    assert.ok(events.includes("open"), "portal opens after the last crystal");
    for (let i = 0; i < 200 && g.phase === "play"; i++) g.tick(right);
    assert.equal(g.phase, "complete", "portal completes the cavern");
    const before = g.score;
    run(idle, 60);
    assert.ok(g.score > before && g.air <= 0, "air paid out as bonus");
    run(idle, 30);
    assert.equal(g.n, 1, "next cavern loads");
}
{
    const { g, run } = lab(["..........", "~~~~", ".S..*........P"].slice(0, 3));
    // Miner stands on row 14 floor; put him on the crumble ledge instead.
    g.miner.y = (12 - 2) * 8;
    g.miner.x = 8;
    run(idle, 40);
    assert.equal(g.tiles[12 * W + 1], ".", "crumbling ledge gives way");
}
{
    const { g, events, run } = lab(["D...........", ".S.k......D*P"]);
    run(right, 30);
    assert.ok(events.includes("lever") && g.doorsOpen, "lever opens doors");
    assert.ok(!g.tiles.includes("D"));
}
{
    const { g, run } = lab([".S..^......*P"]);
    run(right, 40);
    assert.equal(g.phase, "dead", "spikes kill");
    run(idle, 80);
    assert.equal(g.phase, "play");
    assert.equal(g.lives, 2, "a life is spent");
}
{
    const { g, run } = lab([".S.....e....*P"]);
    for (let i = 0; i < 200 && g.phase === "play"; i++) g.tick(idle);
    assert.equal(g.phase, "dead", "guardians kill");
}
{
    const { g, run } = lab([".S..........*P"]);
    g.air = 0.5;
    run(idle, 30);
    assert.equal(g.phase, "dead", "running out of air kills");
    g.lives = 0;
    run(idle, 80);
    assert.equal(g.phase, "over", "no lives left: game over");
}
{
    const { g, events, run } = lab([".S**********P"]);
    g.score = 9950;
    run(right, 20);
    assert.ok(events.includes("extra") && g.lives === 4, "extra life at 10,000");
}

// 5. Voxel characters: only faces exposed to air are emitted, glow voxels go to their own set.
{
    const one = voxelFaces([[0, 0, 0, 1, 1, 1, 0xffffff]]);
    assert.equal(one.solid.pos.length, 6 * 6 * 3, "a lone voxel has 6 faces");
    const two = voxelFaces([
        [0, 0, 0, 2, 1, 1, 0xffffff],
        [1, 0, 0, 1, 1, 1, 0xff0000, 2],
    ]);
    assert.equal(two.solid.pos.length / 18, 5, "shared face hidden, painted voxel replaced");
    assert.equal(two.glow.pos.length / 18, 5, "glow voxel has its own faces");
    assert.equal(voxelFaces([[0, 0, 0, 3, 3, 3, 0xffffff]]).solid.pos.length / 18, 54, "3³ cube: surface only");
}

// 6. GPU tiers, on the renderer strings real devices report (WebGL UNMASKED_RENDERER_WEBGL).
{
    const tier = (renderer: string, mobile: boolean, cores = 8, memGB?: number) =>
        classifyGpu({ renderer, mobile, cores, memGB });
    const cases: [string, Tier][] = [
        [tier("Adreno (TM) 730", true), "mobile-high"], // Galaxy S22 Ultra (Snapdragon 8 Gen 1)
        [tier("Samsung Xclipse 920", true), "mobile-high"], // Galaxy S22 Ultra (Exynos 2200)
        [tier("Apple GPU", true, 6), "mobile-high"], // any iPad / iPhone (Safari masks the GPU)
        [tier("Adreno (TM) 640", true), "mid"], // 2019 flagship (Snapdragon 855)
        [tier("Mali-G76 MP12", true), "mid"], // Galaxy S10 (Exynos 9820)
        [tier("Adreno (TM) 618", true), "low"], // 2019 mid-range
        [tier("Mali-G72 MP3", true), "low"],
        [tier("PowerVR Rogue GE8320", true, 8), "low"], // budget MediaTek, despite 8 cores
        [tier("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)", false), "high"],
        [tier("ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Direct3D11 vs_5_0 ps_5_0, D3D11)", false), "mid"],
        [tier("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", false), "mid"],
        [tier("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)", false), "low"],
        [tier("Apple M1", false), "high"], // Chrome on Apple Silicon
        [tier("Apple GPU", false, 8), "high"], // Safari on Apple Silicon
        [tier("Apple GPU", false, 4), "mid"], // Safari on a 2019 Intel MacBook
        [tier("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)", false), "low"],
        [tier("Adreno (TM) 730", true, 8, 2), "low"], // 2 GB of memory overrides the GPU
    ];
    cases.forEach(([got, want], i) => assert.equal(got, want, `tier case ${i}`));

    // The governor steps down only after a sustained slow window, and stops when out of steps.
    let steps = 0;
    const gov = new Governor(() => ++steps < 3);
    for (let i = 0; i < 200; i++) gov.frame(16.7); // 60 fps: fine
    for (let i = 0; i < 90; i++) gov.frame(33.4); // 30 fps (iOS Low Power Mode cap): not slow
    assert.equal(steps, 0, "smooth or 30 fps-capped frames never degrade");
    for (let i = 0; i < 200; i++) gov.frame(50); // 20 fps: a step per 3 s window
    assert.equal(steps, 3, "slow frames step down, then stop when nothing is left");
    gov.frame(5000); // a stall (tab switch) is ignored
    assert.equal(steps, 3);
}

console.log("check: all passed");

function rowsOf(tiles: string) {
    const rows: string[] = [];
    for (let r = 1; r < H - 1; r++) rows.push(tiles.slice(r * W + 1, r * W + W - 1));
    return rows;
}
