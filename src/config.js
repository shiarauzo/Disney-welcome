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
    // Extra soft-halo multiplier around the solid core.
    haloScale: 2.6,
    // Seconds the trail stays visible before it has faded to ~1.5%.
    // Exponential decay -> "persists a few seconds, then fades smoothly".
    persistSeconds: 3.0,
    // Minimum distance (px) the fingertip must move before we add a new
    // sample. Filters jitter and avoids over-dense geometry.
    minSampleDistance: 2.5,
    // Smoothing factor for the fingertip (0 = raw, 1 = frozen).
    smoothing: 0.45
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
    minTrackingConfidence: 0.5
  },

  // ---- Trace guide (the "draw the ears" homage) ----------------------------
  guide: {
    enabledByDefault: false,
    opacity: 0.3
  },

  // ---- Post ----------------------------------------------------------------
  bloom: {
    strength: 1.35,
    // Blur taps radius in px for the cheap separable-ish bloom.
    radius: 3.0
  }
}

export const DEFAULT_COLOR_INDEX = 1 // Rosa
