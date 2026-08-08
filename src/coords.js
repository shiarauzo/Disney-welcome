// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The single source of truth for coordinate mapping. Both the fingertip input
 * and the composite shader's video sampling derive their transform from HERE so
 * they can never drift apart (the #1 source of "the glow doesn't line up with
 * my finger" bugs).
 *
 * Spaces:
 *  - Image UV (nx, ny): MediaPipe normalized landmark, origin top-left, [0,1].
 *  - Screen UV (top-left origin): [0,1], (0,0) top-left of the canvas.
 *  - Clip / NDC: [-1,1], origin center, y up (what our geometry uses).
 *
 * The video is displayed with "cover" scaling (fills the canvas, crops the
 * overflow) and mirrored horizontally (selfie view).
 */

/**
 * Compute the cover-fit transform between screen space and image space.
 * imageUV = screenUV * (kx,ky) + (ox,oy)   [both top-left origin]
 * @returns {{kx:number, ky:number, ox:number, oy:number}}
 */
export function coverTransform(canvasW, canvasH, videoW, videoH) {
  if (!videoW || !videoH || !canvasW || !canvasH) {
    return { kx: 1, ky: 1, ox: 0, oy: 0 }
  }
  const rs = canvasW / canvasH // screen aspect
  const ri = videoW / videoH // image aspect
  let kx
  let ky
  if (ri > rs) {
    // Image is wider than the screen: fit height, crop left/right.
    kx = rs / ri
    ky = 1
  } else {
    // Image is taller/narrower: fit width, crop top/bottom.
    kx = 1
    ky = ri / rs
  }
  const ox = (1 - kx) / 2
  const oy = (1 - ky) / 2
  return { kx, ky, ox, oy }
}

/**
 * Map a MediaPipe fingertip (image UV) to clip/NDC space, honoring mirror and
 * cover scaling. Returns [x, y] in [-1, 1] with y up.
 */
export function fingertipToClip(nx, ny, cover, mirror = true) {
  const { kx, ky, ox, oy } = cover
  // Invert the composite cover+mirror transform to find where on screen the
  // finger appears.
  const su = mirror ? (1 - nx - ox) / kx : (nx - ox) / kx
  const sv = (ny - oy) / ky
  // Screen UV (top-left) -> clip (center, y up).
  return [su * 2 - 1, 1 - sv * 2]
}
