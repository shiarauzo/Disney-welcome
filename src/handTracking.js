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

const dist2 = (a, b) => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/**
 * Decide whether the hand is "pointing": index extended while the other three
 * fingers are curled. Robust to rotation because it compares tip-to-wrist vs
 * joint-to-wrist distances rather than absolute positions.
 */
function isPointing(lm) {
  const wrist = lm[WRIST]
  const indexExtended = dist2(lm[INDEX_TIP], wrist) > dist2(lm[INDEX_PIP], wrist)
  let curled = 0
  if (dist2(lm[MIDDLE_TIP], wrist) < dist2(lm[MIDDLE_PIP], wrist)) curled++
  if (dist2(lm[RING_TIP], wrist) < dist2(lm[RING_PIP], wrist)) curled++
  if (dist2(lm[PINKY_TIP], wrist) < dist2(lm[PINKY_PIP], wrist)) curled++
  return indexExtended && curled >= 2
}

/**
 * Wraps the MediaPipe HandLandmarker. Emits the index fingertip (normalized
 * image coords) plus whether the pointing gesture is active. Pen-down debounce
 * and mode handling live in the app, not here.
 */
export class HandTracker {
  constructor() {
    this.landmarker = null
    this._lastVideoTime = -1
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
      return { present: false, tip: null, pointing: false }
    }
    // Avoid feeding MediaPipe a duplicate frame (throws on repeated timestamps).
    if (video.currentTime === this._lastVideoTime) {
      return this._last ?? { present: false, tip: null, pointing: false }
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
      this._last = { present: false, tip: null, pointing: false }
      return this._last
    }
    const lm = hands[0]
    const tip = lm[INDEX_TIP]
    // Reject non-finite landmarks so NaN can never reach the render pipeline.
    if (!tip || !Number.isFinite(tip.x) || !Number.isFinite(tip.y)) {
      this._last = { present: false, tip: null, pointing: false }
      return this._last
    }
    this._last = {
      present: true,
      tip: [tip.x, tip.y],
      pointing: isPointing(lm)
    }
    return this._last
  }

  close() {
    this.landmarker?.close?.()
    this.landmarker = null
    this.ready = false
  }
}
