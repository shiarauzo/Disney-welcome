// SPDX-License-Identifier: AGPL-3.0-or-later
import * as THREE from 'three'
import { CONFIG } from '../config.js'
import { FeedbackTarget } from './FeedbackTarget.js'
import {
  FULLSCREEN_VERT,
  SEGMENT_VERT,
  SEGMENT_FRAG,
  FEEDBACK_FRAG,
  COMPOSITE_FRAG
} from '../shaders.js'

const MAX_SEGMENTS = 256

/**
 * Owns the whole WebGL render pipeline:
 *   1. FeedbackPass  — decay the previous accumulation frame.
 *   2. DrawPass      — additively draw this frame's capsule-SDF segments.
 *   3. CompositePass — blend mirrored video + accumulated trail + bloom.
 *   4. Overlays      — sparkles and the trace guide, drawn additively on top.
 *
 * Geometry is authored in clip space so no view/projection matrices are needed;
 * a dummy camera satisfies three's render() signature.
 */
export class RenderPipeline {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      premultipliedAlpha: false,
      alpha: false,
      powerPreference: 'high-performance'
    })
    this.renderer.autoClear = false
    this.renderer.setClearColor(0x000000, 1)
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer.setPixelRatio(this.pixelRatio)

    this.camera = new THREE.Camera() // identity; shaders emit clip space directly
    this.overlays = [] // extra Object3D drawn over the composite (sparkles, guide)

    this._initSegmentPass()
    this._initFullscreenPasses()

    this.setSize(window.innerWidth || 2, window.innerHeight || 2)
  }

  /* ---- setup ------------------------------------------------------------- */

  _initSegmentPass() {
    this.segScene = new THREE.Scene()
    const geo = new THREE.BufferGeometry()
    this._segPos = new Float32Array(MAX_SEGMENTS * 4 * 3)
    this._segStart = new Float32Array(MAX_SEGMENTS * 4 * 2)
    this._segEnd = new Float32Array(MAX_SEGMENTS * 4 * 2)
    const index = new Uint16Array(MAX_SEGMENTS * 6)
    for (let i = 0; i < MAX_SEGMENTS; i++) {
      const v = i * 4
      const o = i * 6
      index[o] = v
      index[o + 1] = v + 1
      index[o + 2] = v + 2
      index[o + 3] = v
      index[o + 4] = v + 2
      index[o + 5] = v + 3
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this._segPos, 3))
    geo.setAttribute('aStart', new THREE.BufferAttribute(this._segStart, 2))
    geo.setAttribute('aEnd', new THREE.BufferAttribute(this._segEnd, 2))
    geo.setIndex(new THREE.BufferAttribute(index, 1))
    geo.setDrawRange(0, 0)
    this._segGeo = geo

    this.segMaterial = new THREE.ShaderMaterial({
      vertexShader: SEGMENT_VERT,
      fragmentShader: SEGMENT_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uColor: { value: new THREE.Color(1, 1, 1) },
        uGlowColor: { value: new THREE.Color(1, 1, 1) },
        uCoreRadius: { value: 3.0 },
        uGlowRadius: { value: CONFIG.trail.radius },
        uGlowFalloff: { value: 2.5 },
        uCoreGain: { value: 1.4 },
        uGlowGain: { value: 1.1 },
        uIntensity: { value: 1.0 }
      }
    })
    const segMesh = new THREE.Mesh(this._segGeo, this.segMaterial)
    segMesh.frustumCulled = false
    this.segScene.add(segMesh)
  }

  _initFullscreenPasses() {
    const quad = new THREE.PlaneGeometry(2, 2)

    this.feedbackScene = new THREE.Scene()
    this.feedbackMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: FEEDBACK_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPrev: { value: null },
        uFade: { value: 0.9 }
      }
    })
    const feedbackQuad = new THREE.Mesh(quad, this.feedbackMaterial)
    feedbackQuad.frustumCulled = false
    this.feedbackScene.add(feedbackQuad)

    this.compositeScene = new THREE.Scene()
    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uVideo: { value: null },
        uTrail: { value: null },
        uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
        uCover: { value: new THREE.Vector4(1, 1, 0, 0) },
        uMirror: { value: 1.0 },
        uBloomStrength: { value: CONFIG.bloom.strength },
        uBloomRadius: { value: CONFIG.bloom.radius },
        uCamDim: { value: 0.82 }
      }
    })
    const compositeQuad = new THREE.Mesh(quad, this.compositeMaterial)
    compositeQuad.frustumCulled = false
    this.compositeScene.add(compositeQuad)

    this.overlayScene = new THREE.Scene()
  }

  _updateScale(dw, dh) {
    // uResolution is in DEVICE pixels, so glow radii must be scaled by the
    // device-pixel-ratio to keep a consistent thickness in CSS pixels.
    this.segMaterial.uniforms.uResolution.value.set(dw, dh)
    this.compositeMaterial.uniforms.uTexel.value.set(1 / dw, 1 / dh)
    this.segMaterial.uniforms.uGlowRadius.value = CONFIG.trail.radius * this.pixelRatio
    this.segMaterial.uniforms.uCoreRadius.value = 3.0 * this.pixelRatio
  }

  /* ---- public API -------------------------------------------------------- */

  setVideoTexture(texture) {
    this.compositeMaterial.uniforms.uVideo.value = texture
  }

  /** @param {number[]} main rgb 0..1  @param {number[]} glow rgb 0..1 */
  setColor(main, glow) {
    this.segMaterial.uniforms.uColor.value.setRGB(main[0], main[1], main[2])
    this.segMaterial.uniforms.uGlowColor.value.setRGB(glow[0], glow[1], glow[2])
  }

  setCover(cover, mirror) {
    this.compositeMaterial.uniforms.uCover.value.set(
      cover.kx,
      cover.ky,
      cover.ox,
      cover.oy
    )
    this.compositeMaterial.uniforms.uMirror.value = mirror ? 1.0 : 0.0
  }

  /** Register an Object3D (clip-space) to draw over the composite. */
  addOverlay(object3d) {
    this.overlayScene.add(object3d)
  }

  /**
   * Upload this frame's segments. Each segment is {a:[x,y], b:[x,y]} in clip
   * space. Builds an axis-aligned quad per segment, expanded by the glow margin.
   */
  setSegments(segments) {
    const size = this.segMaterial.uniforms.uResolution.value
    const marginPx = CONFIG.trail.radius * CONFIG.trail.haloScale * this.pixelRatio + 4
    const mx = (2 * marginPx) / size.x
    const my = (2 * marginPx) / size.y

    const count = Math.min(segments.length, MAX_SEGMENTS)
    for (let i = 0; i < count; i++) {
      const { a, b } = segments[i]
      const x0 = Math.min(a[0], b[0]) - mx
      const x1 = Math.max(a[0], b[0]) + mx
      const y0 = Math.min(a[1], b[1]) - my
      const y1 = Math.max(a[1], b[1]) + my
      const p = i * 12
      const s = i * 8
      // 4 corners: (x0,y0) (x1,y0) (x1,y1) (x0,y1)
      const xs = [x0, x1, x1, x0]
      const ys = [y0, y0, y1, y1]
      for (let c = 0; c < 4; c++) {
        this._segPos[p + c * 3] = xs[c]
        this._segPos[p + c * 3 + 1] = ys[c]
        this._segPos[p + c * 3 + 2] = 0
        this._segStart[s + c * 2] = a[0]
        this._segStart[s + c * 2 + 1] = a[1]
        this._segEnd[s + c * 2] = b[0]
        this._segEnd[s + c * 2 + 1] = b[1]
      }
    }
    this._segGeo.attributes.position.needsUpdate = true
    this._segGeo.attributes.aStart.needsUpdate = true
    this._segGeo.attributes.aEnd.needsUpdate = true
    this._segGeo.setDrawRange(0, count * 6)
    this._segCount = count
  }

  setSize(width, height) {
    // Re-read DPR so moving between monitors of different density is handled.
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer.setPixelRatio(this.pixelRatio)
    this.renderer.setSize(width, height, false)

    const dw = Math.max(2, Math.floor(width * this.pixelRatio))
    const dh = Math.max(2, Math.floor(height * this.pixelRatio))
    if (!this.feedback) {
      this.feedback = new FeedbackTarget(this.renderer, dw, dh)
    } else {
      this.feedback.setSize(dw, dh)
    }
    // Reallocating/resizing loses the accumulation content — clear to black.
    for (const t of [this.feedback.a, this.feedback.b]) {
      this.renderer.setRenderTarget(t)
      this.renderer.clear(true, false, false)
    }
    this.renderer.setRenderTarget(null)
    this._updateScale(dw, dh)
  }

  /** Current device-pixel-ratio (for overlays that size in device px). */
  getPixelRatio() {
    return this.pixelRatio
  }

  /**
   * Render one frame.
   * @param {number} dt seconds since last frame
   */
  render(dt) {
    const r = this.renderer

    // 1. Feedback decay: prev * fade -> write.
    const persist = Math.max(CONFIG.trail.persistSeconds, 0.05)
    const fade = Math.pow(0.015, Math.min(dt, 0.1) / persist)
    this.feedbackMaterial.uniforms.uFade.value = fade
    this.feedbackMaterial.uniforms.uPrev.value = this.feedback.read.texture
    r.setRenderTarget(this.feedback.write)
    r.clear(true, false, false)
    r.render(this.feedbackScene, this.camera)

    // 2. Draw this frame's segments additively on top of the decayed frame.
    if (this._segCount > 0) {
      r.setRenderTarget(this.feedback.write) // still the write target
      r.render(this.segScene, this.camera)
    }
    this.feedback.swap()

    // 3. Composite to screen.
    this.compositeMaterial.uniforms.uTrail.value = this.feedback.read.texture
    r.setRenderTarget(null)
    r.clear(true, false, false)
    r.render(this.compositeScene, this.camera)

    // 4. Overlays (sparkles + guide) additively over the composite.
    r.render(this.overlayScene, this.camera)
  }

  /** Wipe the persistent trail buffers to black. */
  clearTrail() {
    for (const t of [this.feedback.a, this.feedback.b]) {
      this.renderer.setRenderTarget(t)
      this.renderer.clear(true, false, false)
    }
    this.renderer.setRenderTarget(null)
  }
}
