// SPDX-License-Identifier: AGPL-3.0-or-later
import * as THREE from 'three'

/**
 * A ping-pong pair of render targets used for the persistent-trail
 * accumulation buffer. Picks a half-float format when the GPU supports it (so
 * additive light can exceed 1.0 for the bloom), falling back to unsigned byte.
 */
export class FeedbackTarget {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer, width, height) {
    // Half-float accumulation lets additive light exceed 1.0 for the bloom.
    // It requires a color-buffer-float extension to be *renderable*, so check
    // that rather than assuming WebGL2 alone is enough.
    const half =
      renderer.extensions.has('EXT_color_buffer_half_float') ||
      renderer.extensions.has('EXT_color_buffer_float')
    this.type = half ? THREE.HalfFloatType : THREE.UnsignedByteType

    const opts = {
      type: this.type,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false
    }
    this.a = new THREE.WebGLRenderTarget(width, height, opts)
    this.b = new THREE.WebGLRenderTarget(width, height, opts)
    this.read = this.a
    this.write = this.b
  }

  swap() {
    const t = this.read
    this.read = this.write
    this.write = t
  }

  setSize(width, height) {
    this.a.setSize(width, height)
    this.b.setSize(width, height)
  }

  dispose() {
    this.a.dispose()
    this.b.dispose()
  }
}
