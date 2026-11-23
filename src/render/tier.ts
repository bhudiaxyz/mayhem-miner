/**
 * Tier — GPU classification into four quality tiers and the per-tier settings table.
 *
 * Purpose
 *   Scales visual cost to the device so older phones and laptops stay smooth while current
 *   desktops get the full look. A single screen of voxels is cheap, so the tiers only trade
 *   resolution, anti-aliasing, bloom and particle count.
 *     high         desktop discrete GPU / Apple Silicon: DPR 2, 4x MSAA, bloom, shadows
 *     mobile-high  flagship phone / tablet, any WebGL2 iPad / iPhone: DPR 2, 2x MSAA, bloom
 *     mid          modern integrated GPU, 2019-21 phones: DPR 1.5, 2x MSAA, bloom
 *     low          older Intel UHD/HD, budget phones, software GL: DPR 1, no MSAA, no bloom
 *
 * Operations
 *   - TIER_SETTINGS: one row per tier.
 *   - classifyGpu(probe): pure mapping from {renderer string, mobile, cores, memGB} to a tier
 *     (the same rules as the sibling thrust-force project, asserted there against real strings).
 *   - detectTier(): `?tier=high|mobile-high|mid|low` override, else probes a throwaway WebGL2
 *     context for UNMASKED_RENDERER_WEBGL and classifies. Returns 'none' without WebGL2.
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
    /** MSAA samples on the post-processing render target (0 = off). */
    msaa: number;
    bloom: boolean;
    /** Lamp shadow map edge in px (0 = no shadows). */
    shadowMap: number;
    particles: number;
    /** Ground-truth ambient occlusion (GTAOPass): contact shadows where blocks meet. */
    ao: boolean;
}

export const TIER_SETTINGS: Record<Tier, TierSettings> = {
    high: { dprCap: 2, msaa: 4, bloom: true, shadowMap: 2048, particles: 600, ao: true },
    "mobile-high": { dprCap: 2, msaa: 2, bloom: true, shadowMap: 1024, particles: 400, ao: false },
    mid: { dprCap: 1.5, msaa: 2, bloom: true, shadowMap: 0, particles: 400, ao: false },
    low: { dprCap: 1, msaa: 0, bloom: false, shadowMap: 0, particles: 200, ao: false },
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
        // Every WebGL2-capable iOS / iPadOS device (A10+, 2016-) handles mobile-high; the
        // governor catches the oldest. Safari under-reports cores, so check Apple first.
        if (/apple/.test(r)) return "mobile-high";
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
    if (/nvidia|geforce|rtx|radeon (rx|pro)|\brx ?\d{3,4}|apple m\d|apple gpu|arc\(tm\) a\d{3}/.test(r)) return "high";
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
