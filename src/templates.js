// SPDX-License-Identifier: AGPL-3.0-or-later
import * as THREE from 'three'
import { CONFIG } from './config.js'
import { GUIDE_VERT, GUIDE_FRAG } from './shaders.js'

/**
 * The "trace guide" — faint outlines the user follows with their finger, à la
 * the classic wand bumper. Shapes are simple geometric outlines you trace; the
 * project is an unofficial fan homage (see README) and ships no brand assets.
 *
 * Templates are authored in a centered, y-up unit space (~[-1.1, 1.1]) and
 * baked into clip space with an aspect-correct fit so they never look stretched.
 * A single pre-allocated buffer is reused across rebuilds so resizing never
 * leaks GPU buffers.
 */

const CIRCLE_SEGMENTS = 64
const MAX_VERTS = 2048 // safe upper bound across all templates

function circle(cx, cy, r, segments = CIRCLE_SEGMENTS) {
  const pts = []
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2
    pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r])
  }
  return pts
}

function star(cx, cy, outer, inner, points = 5) {
  const pts = []
  for (let i = 0; i <= points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const t = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2
    pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r])
  }
  return pts
}

function heart(scale = 0.062, segments = 96) {
  const pts = []
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2
    const x = 16 * Math.sin(t) ** 3
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t)
    pts.push([x * scale, y * scale])
  }
  return pts
}

function flower(petals = 5, segments = 180) {
  const pts = []
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2
    const r = 0.55 + 0.42 * Math.cos(petals * t)
    pts.push([Math.cos(t) * r, Math.sin(t) * r])
  }
  return pts
}

function spiral(turns = 3, segments = 220) {
  const pts = []
  const max = turns * Math.PI * 2
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * max
    const r = 0.06 + (t / max) * 0.95
    pts.push([Math.cos(t) * r, Math.sin(t) * r])
  }
  return pts
}

/** Each template is a list of polylines (arrays of [x, y]). */
export const TEMPLATES = {
  Orejas: [circle(0, -0.15, 0.62), circle(-0.62, 0.6, 0.34), circle(0.62, 0.6, 0.34)],
  Estrella: [star(0, 0, 0.85, 0.36)],
  Corazón: [heart()],
  Flor: [flower()],
  Espiral: [spiral()]
}

export const TEMPLATE_NAMES = Object.keys(TEMPLATES)

export class TraceGuide {
  constructor() {
    this.names = TEMPLATE_NAMES
    this.index = 0
    this.aspect = 1
    this._time = 0

    this.geometry = new THREE.BufferGeometry()
    this._positions = new Float32Array(MAX_VERTS * 3)
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this._positions, 3)
    )
    this.geometry.setDrawRange(0, 0)

    this.material = new THREE.ShaderMaterial({
      vertexShader: GUIDE_VERT,
      fragmentShader: GUIDE_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(1, 1, 1) },
        uOpacity: { value: CONFIG.guide.opacity }
      }
    })
    this.object = new THREE.LineSegments(this.geometry, this.material)
    this.object.frustumCulled = false
    this.object.visible = CONFIG.guide.enabledByDefault
    this._rebuild()
  }

  get name() {
    return this.names[this.index]
  }

  get visible() {
    return this.object.visible
  }

  setVisible(v) {
    this.object.visible = v
  }

  toggle() {
    this.object.visible = !this.object.visible
    return this.object.visible
  }

  next() {
    this.index = (this.index + 1) % this.names.length
    this._rebuild()
    return this.name
  }

  setColor(main) {
    this.material.uniforms.uColor.value.setRGB(main[0], main[1], main[2])
  }

  setAspect(aspect) {
    this.aspect = aspect
    this._rebuild()
  }

  /**
   * Subtle breathing pulse so the guide reads as "active".
   * @param {number} dt
   * @param {boolean} [pulse] set false to respect prefers-reduced-motion
   */
  update(dt, pulse = true) {
    this._time += dt
    if (!pulse) {
      this.material.uniforms.uOpacity.value = CONFIG.guide.opacity
      return
    }
    const p = 0.75 + 0.25 * Math.sin(this._time * 2.0)
    this.material.uniforms.uOpacity.value = CONFIG.guide.opacity * p
  }

  _rebuild() {
    const polylines = TEMPLATES[this.name]
    const fit = 0.72
    const a = this.aspect
    const sx = fit * (a >= 1 ? 1 / a : 1)
    const sy = fit * (a >= 1 ? 1 : a)

    const pos = this._positions
    let v = 0 // vertex count
    for (const line of polylines) {
      for (let i = 0; i < line.length - 1 && v + 2 <= MAX_VERTS; i++) {
        const p0 = line[i]
        const p1 = line[i + 1]
        pos[v * 3] = p0[0] * sx
        pos[v * 3 + 1] = p0[1] * sy
        pos[v * 3 + 2] = 0
        v++
        pos[v * 3] = p1[0] * sx
        pos[v * 3 + 1] = p1[1] * sy
        pos[v * 3 + 2] = 0
        v++
      }
    }
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.position.addUpdateRange?.(0, v * 3)
    this.geometry.setDrawRange(0, v)
  }
}
