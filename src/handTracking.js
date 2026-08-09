// SPDX-License-Identifier: AGPL-3.0-or-later
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { CONFIG } from './config.js'

const VERSION = '0.10.18'
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

// MediaPipe hand landmark indices we care about.
const WRIST = 0
const INDEX_PIP = 6
const INDEX_TIP = 8
const MIDDLE_PIP = 10
const MIDDLE_TIP = 12
const RING_PIP = 14
const RING_TIP = 16
const PINKY_PIP = 18
const PINKY_TIP = 20

const dist3 = (a, b) => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = (a.z ?? 0) - (b.z ?? 0)
  return dx * dx + dy * dy + dz * dz
}

/** Extension of one finger: tip-to-wrist over joint-to-wrist. ~1 = curled. */
function extension(lm, tipIdx, pipIdx) {
  const wrist = lm[WRIST]
  const pip = Math.sqrt(dist3(lm[pipIdx], wrist))
  if (!(pip > 1e-6)) return 0
  return Math.sqrt(dist3(lm[tipIdx], wrist)) / pip
}

/**
 * How strongly the hand is "pointing", as a continuous score: the index's
 * extension minus the MEDIAN extension of the other three fingers. Positive
 * means the index sticks out past a mostly-closed hand.
 *
 * A score beats the old boolean (index extended AND >=2 others strictly
 * curled) because that test flipped to false whenever a curled fingertip read
 * a hair past its joint. A score plus a Schmitt trigger degrades gracefully
 * instead of chopping the stroke apart.
 *
 * MUST be fed the 3D world landmarks, not the projected image ones. Point the
 * finger AT the camera and its 2D projection collapses to about the length of
 * a curled finger, so a 2D score reads "not pointing" for the single most
 * natural way to draw a line straight ahead.
 *
 * Ratios (not raw distances) keep this stable under rotation and hand size.
 */
function pointingScore(lm) {
  const index = extension(lm, INDEX_TIP, INDEX_PIP)
  const others = [
    extension(lm, MIDDLE_TIP, MIDDLE_PIP),
    extension(lm, RING_TIP, RING_PIP),
    extension(lm, PINKY_TIP, PINKY_PIP)
  ].sort((a, b) => a - b)
  return index - others[1]
}

const NO_HAND = Object.freeze({ present: false, tip: null, pointing: false })

/**
 * Wraps the MediaPipe HandLandmarker. Emits the index fingertip (normalized
 * image coords) plus whether the pointing gesture is active. Pen-down debounce
 * and mode handling live in the app, not here.
 */
export class HandTracker {
  constructor() {
    this.landmarker = null
    this._lastVideoTime = -1
    this._lastGood = null // last frame that actually found a hand
    this._lastGoodAt = -Infinity
    this._pointing = false // Schmitt-trigger state for the pointing gesture
    this._prevTip = null
    this.score = 0 // last pointing score, drives the Schmitt trigger below
    this.tipSpeed = 0 // image fractions per second
    this.ready = false
  }

  async init() {
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: CONFIG.hand.minDetectionConfidence,
      minHandPresenceConfidence: CONFIG.hand.minPresenceConfidence,
      minTrackingConfidence: CONFIG.hand.minTrackingConfidence
    })
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'))
    } catch (err) {
      // Some drivers/browsers can't use the GPU delegate — fall back to CPU.
      // eslint-disable-next-line no-console
      console.warn('MediaPipe GPU delegate no disponible, usando CPU.', err)
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'))
    }
    this.ready = true
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {number} nowMs monotonic timestamp (performance.now())
   * @returns {{present:boolean, tip:[number,number]|null, pointing:boolean}}
   */
  detect(video, nowMs) {
    if (!this.ready || video.readyState < 2) {
      return NO_HAND
    }
    // Avoid feeding MediaPipe a duplicate frame (throws on repeated timestamps).
    if (video.currentTime === this._lastVideoTime) {
      return this._last ?? NO_HAND
    }
    this._lastVideoTime = video.currentTime

    // MediaPipe requires STRICTLY INCREASING timestamps or it throws. Coarsened
    // clocks (privacy.resistFingerprinting, non-cross-origin-isolated) can
    // repeat performance.now(), so force monotonicity.
    const ts = Math.max(nowMs, (this._lastTs ?? -1) + 1)
    this._lastTs = ts

    const result = this.landmarker.detectForVideo(video, ts)
    const hands = result?.landmarks
    if (!hands || hands.length === 0) {
      return this._miss(nowMs)
    }
    const lm = hands[0]
    const tip = lm[INDEX_TIP]
    // Reject non-finite landmarks so NaN can never reach the render pipeline.
    if (!tip || !Number.isFinite(tip.x) || !Number.isFinite(tip.y)) {
      return this._miss(nowMs)
    }
    // Fingertip speed between detections, in image fractions per second.
    const gap = (nowMs - this._lastGoodAt) / 1000
    if (this._prevTip && gap > 1e-4 && gap < 0.5) {
      this.tipSpeed = Math.hypot(tip.x - this._prevTip[0], tip.y - this._prevTip[1]) / gap
    } else {
      this.tipSpeed = 0
    }
    this._prevTip = [tip.x, tip.y]

    // Gesture from the metric 3D landmarks (rotation- and foreshortening-
    // invariant); position from the projected ones, which is what the screen
    // mapping needs. Fall back to the projected set if world data is missing —
    // those carry a relative z too, so the score degrades rather than breaks.
    this.score = pointingScore(result.worldLandmarks?.[0] ?? lm)
    // Schmitt trigger: a clear point to arm, a clearly-open hand to disarm.
    // Disarming is additionally blocked while the hand is moving fast, because
    // that is when blur makes the curl reading collapse — dropping the gesture
    // there would cut the stroke exactly mid-flick.
    if (this._pointing) {
      const blurred = this.tipSpeed > CONFIG.hand.blurSpeed
      if (this.score < CONFIG.hand.pointOff && !blurred) this._pointing = false
    } else if (this.score > CONFIG.hand.pointOn) {
      this._pointing = true
    }
    this._last = {
      present: true,
      tip: [tip.x, tip.y],
      pointing: this._pointing
    }
    this._lastGood = this._last
    this._lastGoodAt = nowMs
    return this._last
  }

  /**
   * A frame with no hand is usually a one-or-two-frame tracking glitch, not the
   * hand leaving. Coast on the last good detection for a short window so the
   * stroke isn't cut into dashes; only report "no hand" once the gap is real.
   */
  _miss(nowMs) {
    const holdMs = Math.max(CONFIG.hand.holdSeconds, 0) * 1000
    if (this._lastGood && nowMs - this._lastGoodAt < holdMs) {
      this._last = this._lastGood
      return this._last
    }
    this._lastGood = null
    this._prevTip = null
    this._pointing = false
    this._last = NO_HAND
    return this._last
  }

  close() {
    this.landmarker?.close?.()
    this.landmarker = null
    this.ready = false
  }
}
