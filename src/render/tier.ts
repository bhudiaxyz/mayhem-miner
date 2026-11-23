/**
 * Tier — GPU classification into four quality tiers and the per-tier settings table.
 *
 * Purpose
 *   Scales visual cost to the device so older phones and laptops stay smooth while current
 *   desktops get the full look. A single screen of voxels is cheap, so the tiers only trade
 *   resolution, anti-aliasing, bloom and particle count.
 *     high         desktop discrete GPU / Apple Silicon: DPR 2, 4x MSAA, bloom, soft shadows,
 *                  torch shadows, AO, uncapped frame rate
 *     mobile-high  flagship phone / tablet, any WebGL2 iPad / iPhone: DPR 2 (≤ 3.7 MP), 2x MSAA,
 *                  bloom, soft shadows, 60 fps cap
 *     mid          modern integrated GPU, 2019-21 phones: DPR 1.5 (≤ 2.1 MP), 2x MSAA, bloom, 60 fps
 *     low          older Intel UHD/HD, budget phones, software GL: DPR 1, no MSAA, no bloom, 60 fps
 *
 * Operations
 *   - TIER_SETTINGS: one row per tier.
 *   - classifyGpu(probe): pure mapping from {renderer string, mobile, cores, memGB} to a tier
 *     (the same rules as the sibling thrust-force project, asserted there against real strings).
 *   - detectTier(): `?tier=high|mobile-high|mid|low` override, else probes a throwaway WebGL2
 *     context for UNMASKED_RENDERER_WEBGL and classifies. Returns 'none' without WebGL2.
 *   - Governor: steps quality down at runtime if frames stay slow (resolution, then bloom,
 *     then shadows), so a wrong guess on an old phone or tablet still ends up smooth.
 *
 * Usage
 *   main.ts: const tier = detectTier(); new View(el, TIER_SETTINGS[tier]).
 *
 * See also: render/view.ts, main.ts; DESIGN.md "12. Quality tiers".
 */
export type Tier = "high" | "mobile-high" | "mid" | "low";

export interface TierSettings {
    /** Max device pixel ratio for the drawing buffer. */
    dprCap: number;
    /** Drawing-buffer pixel budget: DPR drops further on big screens (iPad Pro, 4K) to stay under it. */
    maxPixels: number;
    /** Render-rate cap (0 = the display's rate). The game ticks at 40 Hz, so 60 fps is plenty on phones. */
    maxFps: number;
    /** Soft (PCF) shadow edges, and the helmet torch casting shadows too. */
    softShadows: boolean;
    torchShadow: boolean;
    /** MSAA samples on the post-processing render target (0 = off). */
    msaa: number;
    bloom: boolean;
    /** Lamp shadow map edge in px (0 = no shadows). */
    shadowMap: number;
    particles: number;
    /** Ground-truth ambient occlusion (GTAOPass): contact shadows where blocks meet. */
    ao: boolean;
}

const MP = 1e6;
export const TIER_SETTINGS: Record<Tier, TierSettings> = {
    high: {
        dprCap: 2,
        maxPixels: 8.3 * MP,
        maxFps: 0,
        msaa: 4,
        bloom: true,
        shadowMap: 2048,
        softShadows: true,
        torchShadow: true,
        particles: 600,
        ao: true,
    },
    "mobile-high": {
        dprCap: 2,
        maxPixels: 3.7 * MP,
        maxFps: 60,
        msaa: 2,
        bloom: true,
        shadowMap: 1024,
        softShadows: true,
        torchShadow: false,
        particles: 400,
        ao: false,
    },
    mid: {
        dprCap: 1.5,
        maxPixels: 2.1 * MP,
        maxFps: 60,
        msaa: 2,
        bloom: true,
        shadowMap: 0,
        softShadows: false,
        torchShadow: false,
        particles: 400,
        ao: false,
    },
    low: {
        dprCap: 1,
        maxPixels: 1.3 * MP,
        maxFps: 60,
        msaa: 0,
        bloom: false,
        shadowMap: 0,
        softShadows: false,
        torchShadow: false,
        particles: 200,
        ao: false,
    },
};

export interface GpuProbe {
    renderer: string;
    mobile: boolean;
    cores: number;
    memGB?: number;
}

export function classifyGpu(p: GpuProbe): Tier {
    const r = p.renderer.toLowerCase();
    if (/swiftshader|llvmpipe|software|basic render/.test(r) || (p.memGB ?? 8) <= 2) return "low";
    if (p.mobile) {
        // Every WebGL2-capable iOS / iPadOS device (A10+, 2016-) starts at mobile-high; the
        // pixel budget and the Governor catch the oldest. Safari under-reports cores, so check Apple first.
        if (/apple/.test(r)) return "mobile-high";
        // PowerVR (MediaTek Helio and other budget SoCs): low, whatever the core count.
        if (/powervr/.test(r)) return "low";
        const adreno = /adreno[^0-9]*(\d{3})/.exec(r);
        if (adreno) return +adreno[1] >= 700 ? "mobile-high" : +adreno[1] >= 630 ? "mid" : "low";
        if (/xclipse|immortalis/.test(r)) return "mobile-high";
        const mali = /mali-g(\d+)/.exec(r);
        if (mali) return +mali[1] >= 710 ? "mobile-high" : +mali[1] >= 76 ? "mid" : "low";
        return p.cores >= 8 ? "mid" : "low";
    }
    if (p.cores <= 2) return "low";
    // Entry-level / old discrete GPUs (GTX 9xx, 1030-1050, MX, GT): mid rather than high.
    if (/gtx ?(9\d\d|10[3-5]0)|\bmx ?\d{2,3}\b|\bgt ?\d{3,4}\b|rx ?5[56]0\b/.test(r)) return "mid";
    // Safari reports "Apple GPU" on every Mac, Intel ones included: Apple Silicon has 8+ cores.
    if (/apple gpu/.test(r)) return p.cores >= 8 ? "high" : "mid";
    if (/nvidia|geforce|rtx|radeon (rx|pro)|\brx ?\d{3,4}|apple m\d|arc\(tm\) a\d{3}/.test(r)) return "high";
    if (/arc|iris|radeon|vega/.test(r)) return "mid";
    if (/intel/.test(r)) return "low";
    return p.cores >= 8 ? "mid" : "low";
}

/** `?tier=` wins, then the GPU probe. */
export function detectTier(): Tier | "none" {
    const forced = new URLSearchParams(location.search).get("tier");
    if (forced && forced in TIER_SETTINGS) return forced as Tier;
    let renderer = "";
    try {
        const gl = document.createElement("canvas").getContext("webgl2", { powerPreference: "high-performance" });
        if (!gl) return "none";
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
        gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
        return "none";
    }
    const ua = navigator.userAgent;
    const mobile = /Mobi|Android|iPad|iPhone/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    return classifyGpu({
        renderer,
        mobile,
        cores: navigator.hardwareConcurrency || 4,
        memGB: (navigator as { deviceMemory?: number }).deviceMemory,
    });
}

/**
 * Governor: a safety net under the tier guess. Fed the time between rendered frames, it asks
 * for one step down (onStep) when the average stays slower than SLOW_MS for WINDOW_S, then
 * waits a fresh window before judging again. Steps never go back up, so quality can't
 * oscillate. SLOW_MS sits below iOS Low Power Mode's 30 fps cap, which must not count as slow.
 * reset() after a pause, a hidden tab or a cavern build (shader and texture uploads hitch).
 */
export class Governor {
    static SLOW_MS = 38;
    static WINDOW_S = 3;
    private sum = 0;
    private n = 0;
    private elapsed = 0;

    private onStep: () => boolean;

    constructor(onStep: () => boolean) {
        this.onStep = onStep;
    }

    frame(ms: number) {
        if (ms <= 0 || ms > 250) return; // a stall (tab switch, GC), not a steady rate
        this.sum += ms;
        this.n++;
        this.elapsed += ms / 1000;
        if (this.elapsed < Governor.WINDOW_S) return;
        const slow = this.sum / this.n > Governor.SLOW_MS;
        this.reset();
        if (slow && !this.onStep()) this.frame = () => {}; // nothing left to shed
    }

    reset() {
        this.sum = this.n = this.elapsed = 0;
    }
}
