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
    this.smooth = null
  }

  /**
   * @param {[number,number]|null} tip clip-space fingertip, or null if no pen
   * @returns {{segments: {a:number[], b:number[]}[], tip: number[]|null}}
   */
  update(tip) {
    if (!tip) {
      this.reset()
      return { segments: [], tip: null }
    }

    const sf = CONFIG.trail.smoothing
    if (!this.smooth) {
      this.smooth = [tip[0], tip[1]]
    } else {
      this.smooth[0] = this.smooth[0] * sf + tip[0] * (1 - sf)
      this.smooth[1] = this.smooth[1] * sf + tip[1] * (1 - sf)
    }

    if (!this.last) {
      this.last = [this.smooth[0], this.smooth[1]]
      return { segments: [], tip: this.smooth }
    }

    const pxPerClipX = this.cssW / 2
    const pxPerClipY = this.cssH / 2
    const dx = (this.smooth[0] - this.last[0]) * pxPerClipX
    const dy = (this.smooth[1] - this.last[1]) * pxPerClipY
    const dist = Math.hypot(dx, dy)

    // Teleport rejection: a jump larger than ~half the viewport is a tracking
    // glitch, not a stroke.
    const maxJump = 0.55 * Math.min(this.cssW, this.cssH)
    if (dist > maxJump) {
      this.last = [this.smooth[0], this.smooth[1]]
      return { segments: [], tip: this.smooth }
    }

    if (dist < CONFIG.trail.minSampleDistance) {
      return { segments: [], tip: this.smooth }
    }

    const seg = {
      a: [this.last[0], this.last[1]],
      b: [this.smooth[0], this.smooth[1]]
    }
    this.last = [this.smooth[0], this.smooth[1]]
    return { segments: [seg], tip: this.smooth }
  }
}
