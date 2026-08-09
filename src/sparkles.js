// SPDX-License-Identifier: AGPL-3.0-or-later
import * as THREE from 'three'
import { CONFIG } from './config.js'
import { SPARKLE_VERT, SPARKLE_FRAG } from './shaders.js'

const rand = (a, b) => a + Math.random() * (b - a)

/**
 * A pooled, GPU-rendered shimmer of star sparkles emitted along the trail —
 * the "magic wand dust" of the bumper homage. Positions live in clip space so
 * they render with the same identity camera as everything else.
 */
export class SparkleSystem {
  constructor() {
    const max = CONFIG.sparkles.max
    this.max = max
    this.cursor = 0
    this.cssW = 1
    this.cssH = 1

    this.pos = new Float32Array(max * 3)
    this.birthLife = new Float32Array(max * 2) // age, life
    this.size = new Float32Array(max)
    this.seed = new Float32Array(max)
    this.velX = new Float32Array(max)
    this.velY = new Float32Array(max)

    // Start all particles dead (life 0 -> alpha 0 -> discarded).
    for (let i = 0; i < max; i++) this.birthLife[i * 2 + 1] = 0

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    geo.setAttribute('aBirthLife', new THREE.BufferAttribute(this.birthLife, 2))
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1))
    this.geometry = geo

    this.material = new THREE.ShaderMaterial({
      vertexShader: SPARKLE_VERT,
      fragmentShader: SPARKLE_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uColor: { value: new THREE.Color(1, 1, 1) },
        uGlowColor: { value: new THREE.Color(1, 1, 1) }
      }
    })

    this.object = new THREE.Points(geo, this.material)
    this.object.frustumCulled = false
  }

  setViewport(cssW, cssH) {
    this.cssW = Math.max(cssW, 1)
    this.cssH = Math.max(cssH, 1)
  }

  setPixelRatio(pr) {
    this.material.uniforms.uPixelRatio.value = pr
  }

  setColor(main, glow) {
    this.material.uniforms.uColor.value.setRGB(main[0], main[1], main[2])
    this.material.uniforms.uGlowColor.value.setRGB(glow[0], glow[1], glow[2])
  }

  /**
   * Spawn a burst of sparkles at a clip-space position.
   * @param {number} x clip x
   * @param {number} y clip y
   * @param {number} [count]
   */
  spawn(x, y, count = CONFIG.sparkles.perSample) {
    const cfg = CONFIG.sparkles
    for (let n = 0; n < count; n++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % this.max
      // Random offset around the fingertip, converted px -> clip.
      const ox = (rand(-1, 1) * cfg.spread) / (this.cssW / 2)
      const oy = (rand(-1, 1) * cfg.spread) / (this.cssH / 2)
      this.pos[i * 3] = x + ox
      this.pos[i * 3 + 1] = y + oy
      this.pos[i * 3 + 2] = 0
      this.birthLife[i * 2] = 0
      this.birthLife[i * 2 + 1] = rand(cfg.lifetime[0], cfg.lifetime[1])
      this.size[i] = rand(cfg.size[0], cfg.size[1])
      this.seed[i] = Math.random()
      this.velX[i] = rand(-6, 6) / (this.cssW / 2)
      this.velY[i] = cfg.riseSpeed / (this.cssH / 2) // upward (clip +y)
    }
    // aSize/aSeed only change on spawn, so upload them here (not every frame).
    this.geometry.attributes.aSize.needsUpdate = true
    this.geometry.attributes.aSeed.needsUpdate = true
  }

  /** Advance particle ages and positions. */
  update(dt, time) {
    this.material.uniforms.uTime.value = time
    for (let i = 0; i < this.max; i++) {
      const life = this.birthLife[i * 2 + 1]
      if (life <= 0) continue
      let age = this.birthLife[i * 2] + dt
      if (age >= life) {
        this.birthLife[i * 2 + 1] = 0 // retire
        continue
      }
      this.birthLife[i * 2] = age
      this.pos[i * 3] += this.velX[i] * dt
      this.pos[i * 3 + 1] += this.velY[i] * dt
    }
    // Only position and age change every frame.
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.aBirthLife.needsUpdate = true
  }
}
