// SPDX-License-Identifier: AGPL-3.0-or-later
import { CONFIG } from './config.js'

/**
 * Turns the (possibly jittery) stream of fingertip positions into clean stroke
 * segments in clip space. Responsibilities:
 *  - exponential smoothing of the fingertip,
 *  - distance-gated sampling (ignore sub-pixel jitter),
 *  - "teleport" rejection so a tracking jump doesn't draw a line across screen,
 *  - dropping the last point on pen-up so no bridging segment appears.
 */
export class TrailSampler {
  constructor() {
    this.last = null // last committed clip point [x, y]
    this.prev = null // the one before it, for the curve's start tangent
    this.smooth = null // smoothed clip point
    this.cssW = 1
    this.cssH = 1
  }

  setViewport(cssW, cssH) {
    this.cssW = Math.max(cssW, 1)
    this.cssH = Math.max(cssH, 1)
  }

  reset() {
    this.last = null
    this.prev = null
    this.smooth = null
  }

  /**
   * @param {[number,number]|null} tip clip-space fingertip, or null if no pen
   * @param {number} dt seconds since the last call
   * @returns {{segments: {a:number[], b:number[]}[], tip: number[]|null}}
   */
  update(tip, dt) {
    // Treat a missing OR non-finite tip as pen-up. A NaN would otherwise make
    // this.smooth sticky-NaN and emit poisoned segments forever.
    if (!tip || !Number.isFinite(tip[0]) || !Number.isFinite(tip[1])) {
      this.reset()
      return { segments: [], tip: null }
    }

    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 1 / 60
    const pxPerClipX = this.cssW / 2
    const pxPerClipY = this.cssH / 2

    if (!this.smooth) {
      this.smooth = [tip[0], tip[1]]
    } else {
      // Speed-adaptive smoothing. A fixed weight has to choose between jitter
      // when still and lag when fast; blending between two weights by speed
      // gets both. Raising it to `step * 60` makes the result frame-rate
      // independent, so 120 Hz doesn't smooth twice as hard as 60 Hz.
      const vx = (tip[0] - this.smooth[0]) * pxPerClipX
      const vy = (tip[1] - this.smooth[1]) * pxPerClipY
      const speed = Math.hypot(vx, vy) / step
      const { smoothing, smoothingFast, slowSpeed, fastSpeed } = CONFIG.trail
      const span = Math.max(fastSpeed - slowSpeed, 1e-6)
      const t = Math.min(Math.max((speed - slowSpeed) / span, 0), 1)
      const keep = smoothing + (smoothingFast - smoothing) * t
      const k = Math.pow(Math.min(Math.max(keep, 0), 0.999), step * 60)
      this.smooth[0] = this.smooth[0] * k + tip[0] * (1 - k)
      this.smooth[1] = this.smooth[1] * k + tip[1] * (1 - k)
    }

    if (!this.last) {
      this.last = [this.smooth[0], this.smooth[1]]
      this.prev = null
      return { segments: [], tip: this.smooth }
    }

    const dx = (this.smooth[0] - this.last[0]) * pxPerClipX
    const dy = (this.smooth[1] - this.last[1]) * pxPerClipY
    const dist = Math.hypot(dx, dy)

    // Teleport rejection. Measured against the viewport DIAGONAL and set high:
    // dropping a segment leaves a visible hole in the stroke, so this should
    // only catch a landmark popping to nonsense, never a genuine fast flick.
    const maxJump = CONFIG.trail.maxJumpFraction * Math.hypot(this.cssW, this.cssH)
    if (!Number.isFinite(dist) || dist > maxJump) {
      this.last = [this.smooth[0], this.smooth[1]]
      // Don't let a rejected jump feed the next span's tangent.
      this.prev = null
      return { segments: [], tip: this.smooth }
    }

    if (dist < CONFIG.trail.minSampleDistance) {
      return { segments: [], tip: this.smooth }
    }

    return { segments: this._curveTo(this.smooth), tip: this.smooth }
  }

  /**
   * Emit the span from `this.last` to `next` as a subdivided Catmull-Rom curve
   * instead of one straight chord, and advance the point history.
   *
   * The end tangent is one-sided: there is no future sample yet, and waiting
   * for one would add a frame of lag to a trail that should feel stuck to the
   * fingertip. The next span starts with the matching position, so the stroke
   * stays connected — only the curvature is estimated slightly late.
   *
   * @param {number[]} next clip-space endpoint
   */
  _curveTo(next) {
    const p1 = this.last
    const p0 = this.prev ?? p1 // no history yet -> degenerates to a straight line
    // Catmull-Rom tangents (the usual half-of-the-neighbour-chord).
    const m1x = (next[0] - p0[0]) * 0.5
    const m1y = (next[1] - p0[1]) * 0.5
    const m2x = next[0] - p1[0]
    const m2y = next[1] - p1[1]

    // Size the subdivision by the length of the equivalent Bézier's control
    // polygon, which bounds the arc from above. Using the straight chord would
    // undercount exactly where it matters — a curve that bulges far from it.
    const kx = this.cssW / 2
    const ky = this.cssH / 2
    const b1x = p1[0] + m1x / 3
    const b1y = p1[1] + m1y / 3
    const b2x = next[0] - m2x / 3
    const b2y = next[1] - m2y / 3
    const arcPx =
      Math.hypot((b1x - p1[0]) * kx, (b1y - p1[1]) * ky) +
      Math.hypot((b2x - b1x) * kx, (b2y - b1y) * ky) +
      Math.hypot((next[0] - b2x) * kx, (next[1] - b2y) * ky)

    const steps = Math.min(
      Math.max(Math.ceil(arcPx / CONFIG.trail.curveStepPx), 1),
      CONFIG.trail.maxCurveSteps
    )

    const segments = []
    let ax = p1[0]
    let ay = p1[1]
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const t2 = t * t
      const t3 = t2 * t
      // Hermite basis. At t = 1 this lands exactly on `next`, so the stroke
      // can't drift away from the fingertip as spans accumulate.
      const h00 = 2 * t3 - 3 * t2 + 1
      const h10 = t3 - 2 * t2 + t
      const h01 = -2 * t3 + 3 * t2
      const h11 = t3 - t2
      const bx = h00 * p1[0] + h10 * m1x + h01 * next[0] + h11 * m2x
      const by = h00 * p1[1] + h10 * m1y + h01 * next[1] + h11 * m2y
      segments.push({ a: [ax, ay], b: [bx, by] })
      ax = bx
      ay = by
    }

    this.prev = [p1[0], p1[1]]
    this.last = [next[0], next[1]]
    return segments
  }
}
