// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Central tuning for the whole experience. Everything visual and behavioural
 * that you might want to tweak lives here so collaborators don't have to dig
 * through the render code.
 */

/**
 * The glow palette. Each entry is a named neon color used for the trail, the
 * bloom and the sparkles. `main` is the core color, `glow` is a slightly
 * lifted variant used for the soft halo. The palette is intentionally a plain
 * array so it's trivial to add your own colors.
 *
 * Purple is the classic wand-bumper color; yellow and pink are the two the
 * project ships with as the primary switch.
 */
export const PALETTE = [
  { name: 'Amarillo', main: [1.0, 0.85, 0.2], glow: [1.0, 0.95, 0.55] },
  { name: 'Rosa', main: [1.0, 0.25, 0.68], glow: [1.0, 0.55, 0.82] },
  { name: 'Morado', main: [0.66, 0.35, 1.0], glow: [0.82, 0.6, 1.0] }
]

export const CONFIG = {
  // ---- Trail (glow line) ----------------------------------------------------
  trail: {
    // Radius of the glowing stroke, in CSS pixels (scaled by DPR internally).
    radius: 26,
    // Extra soft-halo multiplier around the solid core (drives the quad margin).
    haloScale: 3.0,
    // 3-band "light" model: a white-hot core, a saturated hue ring and a wide
    // soft halo. High coreGain pushes the HDR buffer well past 1.0 so the
    // centerline blows out to white (reads as light, not paint).
    coreGain: 6.0,
    coreSharpness: 34.0,
    innerGain: 1.6,
    innerSharpness: 5.0,
    outerGain: 0.7,
    outerFalloff: 2.2,
    intensity: 1.0,
    // Seconds the trail stays visible before it has faded to ~1.5%.
    // Exponential decay -> "persists a few seconds, then fades smoothly".
    persistSeconds: 3.0,
    // Minimum distance (px) the fingertip must move before we add a new
    // sample. Filters jitter and avoids over-dense geometry.
    minSampleDistance: 2.5,
    // Speed-adaptive smoothing: the "keep previous" weight (0 = raw, 1 =
    // frozen), authored per 60 fps frame and rescaled to the real frame time.
    // Heavy when the finger is nearly still (kills jitter), almost none when
    // it's moving fast — otherwise the smoothed point lags behind and the end
    // of a quick stroke never gets drawn.
    smoothing: 0.6,
    smoothingFast: 0.08,
    // Fingertip speeds (px/s) that map onto those two weights.
    slowSpeed: 120,
    fastSpeed: 1400,
    // A jump bigger than this fraction of the viewport DIAGONAL is treated as a
    // tracking glitch instead of a stroke. Generous on purpose: detections
    // arrive at ~30 fps, so a real flick covers a lot of ground between two of
    // them, and clipping that is what breaks fast strokes into pieces.
    maxJumpFraction: 0.85,
    // Curve interpolation. Detections arrive at ~30 fps, so a fast stroke
    // would otherwise be drawn as straight chords between samples and quick
    // curves look faceted. Each span is subdivided into roughly one
    // sub-segment per `curveStepPx`, capped at `maxCurveSteps`.
    curveStepPx: 10,
    maxCurveSteps: 24
  },

  // ---- Sparkles (shimmer particles) ----------------------------------------
  sparkles: {
    max: 1200, // pool size
    perSample: 3, // how many spawn per accepted fingertip sample
    lifetime: [0.6, 1.6], // seconds, random per particle
    size: [4, 14], // px, random per particle
    spread: 22, // px, random offset from the fingertip
    riseSpeed: 18, // px/s upward drift, like the bumper's floating shimmer
    twinkleSpeed: [6, 16] // rad/s flicker frequency
  },

  // ---- Hand tracking / gesture ---------------------------------------------
  hand: {
    // Draw only while the index finger is "pointing" (extended while middle
    // finger is curled). Set false to always draw when a hand is visible.
    requirePointingGesture: true,
    // MediaPipe detection confidence thresholds.
    minDetectionConfidence: 0.5,
    minPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    // Seconds to coast on the last good landmarks when a frame loses the hand.
    // Motion blur makes the detector lose a fast-moving hand for several frames
    // in a row, so this has to outlast a flick: when tracking comes back the
    // sampler still has its previous point and bridges the gap, instead of
    // having reset and leaving a hole exactly where the stroke was fastest.
    holdSeconds: 0.35,
    // Above this fingertip speed (fractions of the image per second) the curl
    // classification is not trustworthy — blur smears the fingers together — so
    // the pointing gesture holds rather than dropping out mid-flick.
    blurSpeed: 0.7,
    // How long the gesture must agree before the pen goes down / comes back up.
    // In SECONDS, not frames: rAF runs at 60-120 Hz while the camera only
    // yields new detections at ~30 fps, so a frame count means different things
    // on different displays. Asymmetric on purpose: quick to start drawing,
    // slow to lift, so a misread frame mid-stroke doesn't break the line.
    penDownSeconds: 0.05,
    penUpSeconds: 0.3,
    // Schmitt trigger on the "pointing" score (index extension minus the median
    // extension of the other three fingers). Turning ON needs a clear point;
    // staying on is much cheaper, so the gesture doesn't flicker mid-stroke.
    // Lower `pointOn` if pointing isn't detected; raise it if it triggers with
    // an open hand.
    pointOn: 0.2,
    pointOff: 0.08
  },

  // ---- Trace guide (the "draw the ears" homage) ----------------------------
  guide: {
    enabledByDefault: false,
    opacity: 0.3
  },

  // ---- Post ----------------------------------------------------------------
  bloom: {
    strength: 1.3,
    // Base ring radius (px); the composite stacks rings at 1x/3x/8x for a wide,
    // soft, film-like halo.
    radius: 4.0,
    // Exposure into the ACES curve; higher = hotter cores roll to white.
    exposure: 0.95,
    // How much the wide halo darkens its surround (local contrast so the glow
    // stays punchy over a bright camera image).
    surroundDim: 0.35
  }
}

export const DEFAULT_COLOR_INDEX = 1 // Rosa
