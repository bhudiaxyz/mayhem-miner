/**
 * Preview — an animated turntable of the miner, a creature or an obstacle, for How to play.
 *
 * Purpose
 *   Shows each character moving, so players recognise it in a cavern.
 *
 * Operations
 *   - animatePreviews(root): animates every canvas[data-preview] under root ("miner", a PROPS id or a
 *     CREATURES id) with ONE small WebGL renderer. Each frame it reads the canvas's current
 *     data-preview (so a Help carousel just changes the attribute), poses that model (walk
 *     cycle), turns it slowly, renders and copies the image into the canvas. Models are built
 *     on first view and cached. Returns stop(), which ends the loop and frees the renderer,
 *     models and GPU context.
 *
 * Usage
 *   main.ts: const stop = animatePreviews(sheetBody); … stop() when the sheet closes.
 *
 * Highlights
 *   - Only exists while the sheet is open: no cost during play.
 *   - No spare WebGL context: the canvas stays blank and the text still describes the creature.
 *
 * See also: render/characters.ts (models, CREATURES), ui/menu.ts (creaturesHelp).
 */
import * as THREE from "three";
import { CREATURES, minerModel, type Character } from "./characters";
import { propModel, PROPS, type PropId } from "./props";

const SIZE = 192;

export function animatePreviews(root: HTMLElement): () => void {
    const canvases = [...root.querySelectorAll<HTMLCanvasElement>("canvas[data-preview]")];
    if (!canvases.length) return () => {};
    let renderer: THREE.WebGLRenderer;
    try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
        return () => {};
    }
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xe0e8ff, 0x302820, 2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 5, 4);
    scene.add(key);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(1.5, 1.6, 5.2);
    camera.lookAt(0, 1, 0);

    const models = new Map<string, Character>();
    const modelFor = (id: string) => {
        let m = models.get(id);
        if (!m) {
            const c = CREATURES.find((e) => e.id === id);
            m = c ? c.make(c.preview) : PROPS.includes(id as PropId) ? propModel(id as PropId) : minerModel();
            m.group.visible = false;
            scene.add(m.group);
            models.set(id, m);
        }
        return m;
    };

    // Reduced motion: still render (so a changed creature shows), but hold the pose and turn.
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0,
        last = performance.now(),
        t = 0;
    const frame = (now: number) => {
        const dt = still ? 0 : Math.max(0, Math.min(0.05, (now - last) / 1000));
        last = now;
        t += dt;
        for (const cv of canvases) {
            const m = modelFor(cv.dataset.preview ?? "miner");
            m.group.visible = true;
            m.group.rotation.y = -0.45 + Math.sin(t * 0.6) * 0.7;
            m.pose({ dt, t, phase: t * 5, mode: "walk", land: 0, reach: 1.4 });
            renderer.render(scene, camera);
            const ctx = cv.getContext("2d")!;
            ctx.clearRect(0, 0, cv.width, cv.height);
            ctx.drawImage(renderer.domElement, 0, 0, cv.width, cv.height);
            m.group.visible = false;
        }
        raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
        cancelAnimationFrame(raf);
        scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            mesh.geometry?.dispose();
            const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
            if (mat)
                for (const mm of Array.isArray(mat) ? mat : [mat]) {
                    for (const t of [
                        (mm as THREE.MeshStandardMaterial).map,
                        (mm as THREE.MeshStandardMaterial).bumpMap,
                    ])
                        t?.dispose();
                    mm.dispose();
                }
        });
        renderer.dispose();
        renderer.forceContextLoss();
    };
}
