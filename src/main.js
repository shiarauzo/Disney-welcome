// SPDX-License-Identifier: AGPL-3.0-or-later
import * as THREE from 'three'
import './style.css'

import { CONFIG, PALETTE, DEFAULT_COLOR_INDEX } from './config.js'
import { startCamera, CameraError } from './camera.js'
import { HandTracker } from './handTracking.js'
import { TrailSampler } from './trail.js'
import { SparkleSystem } from './sparkles.js'
import { TraceGuide } from './templates.js'
import { RenderPipeline } from './render/pipeline.js'
import { coverTransform, fingertipToClip } from './coords.js'
import { UI } from './ui.js'

// We drive color ourselves through custom shaders, so disable three's automatic
// color management to keep the math predictable.
THREE.ColorManagement.enabled = false

class App {
  constructor() {
    this.video = document.getElementById('input-video')
    this.canvas = document.getElementById('stage')
    this.uiRoot = document.getElementById('ui')

    // Touch devices have no spacebar, so the "held" mode would be a dead-end —
    // exclude it there.
    this.isTouch =
      window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window
    this.drawModes = this.isTouch ? ['gesture', 'always'] : ['gesture', 'held', 'always']
    this.reducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    this.colorIndex = DEFAULT_COLOR_INDEX
    this.drawMode = CONFIG.hand.requirePointingGesture ? 'gesture' : 'always'
    this.spaceHeld = false
    this.penDown = false
    this._downFrames = 0
    this._upFrames = 0
    this.cover = { kx: 1, ky: 1, ox: 0, oy: 0 }
    this.mirror = true
    this.running = false
    this._lastT = 0
    this._fpsAccum = 0
    this._fpsFrames = 0
    this._hudTick = 0

    this.pipeline = new RenderPipeline(this.canvas)
    this.tracker = new HandTracker()
    this.sampler = new TrailSampler()
    this.sparkles = new SparkleSystem()
    this.guide = new TraceGuide()

    this.pipeline.addOverlay(this.guide.object)
    this.pipeline.addOverlay(this.sparkles.object)

    this.ui = new UI(this.uiRoot, {
      onStart: () => this.start(),
      onColor: (i) => this.setColor(i),
      onCycleDrawMode: () => this.cycleDrawMode(),
      onToggleGuide: () => this.toggleGuide(),
      onCycleTemplate: () => this.cycleTemplate(),
      onClear: () => this.clear()
    })

    this._applyColor()
    this.ui.setColorActive(this.colorIndex)
    this.ui.setDrawMode(this.drawMode)
    this.ui.setGuide(this.guide.visible, this.guide.name)

    this._bindEvents()
    this._resize()
  }

  /* ---- lifecycle --------------------------------------------------------- */

  async start() {
    try {
      this.ui.setStatus('Encendiendo cámara…')
      await startCamera(this.video)
      this._setupVideoTexture()
      this._resize()

      this.ui.setStatus('Cargando detección de mano…')
      try {
        await this.tracker.init()
      } catch (modelErr) {
        // eslint-disable-next-line no-console
        console.error('Fallo al cargar el modelo de MediaPipe', modelErr)
        this.ui.showError(
          'No se pudo cargar la detección de manos',
          'El modelo se descarga desde un CDN la primera vez. Revisa tu conexión a internet e inténtalo de nuevo.'
        )
        return
      }

      this.ui.hideOverlay()
      this.ui.setStatus('¡Listo! Apunta con el índice ☝️')
      this.running = true
      this._lastT = performance.now()
      requestAnimationFrame((t) => this._loop(t))
    } catch (err) {
      this._handleFatal(err)
    }
  }

  _setupVideoTexture() {
    const tex = new THREE.VideoTexture(this.video)
    tex.flipY = false
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false
    this.pipeline.setVideoTexture(tex)
  }

  _handleFatal(err) {
    this.running = false
    if (err instanceof CameraError) {
      this.ui.showError('Cámara no disponible', err.message)
    } else {
      this.ui.showError(
        'Algo salió mal',
        `No se pudo iniciar la experiencia: ${err?.message ?? err}`
      )
    }
    // eslint-disable-next-line no-console
    console.error(err)
  }

  /* ---- controls ---------------------------------------------------------- */

  setColor(i) {
    this.colorIndex = ((i % PALETTE.length) + PALETTE.length) % PALETTE.length
    this._applyColor()
    this.ui.setColorActive(this.colorIndex)
  }

  _applyColor() {
    const c = PALETTE[this.colorIndex]
    this.pipeline.setColor(c.main, c.glow)
    this.sparkles.setColor(c.main, c.glow)
    this.guide.setColor(c.glow)
  }

  cycleDrawMode() {
    const idx = this.drawModes.indexOf(this.drawMode)
    this.drawMode = this.drawModes[(idx + 1) % this.drawModes.length]
    this.ui.setDrawMode(this.drawMode)
  }

  toggleGuide() {
    const v = this.guide.toggle()
    this.ui.setGuide(v, this.guide.name)
  }

  cycleTemplate() {
    const name = this.guide.next()
    this.ui.setGuide(this.guide.visible, name)
  }

  clear() {
    this.pipeline.clearTrail()
    this.sampler.reset()
  }

  /* ---- events ------------------------------------------------------------ */

  _bindEvents() {
    window.addEventListener('resize', () => this._scheduleResize())
    window.addEventListener('orientationchange', () => this._scheduleResize())
    window.addEventListener('keydown', (e) => {
      // Shortcuts only act once the experience is running (not on the intro).
      if (!this.running) return
      if (e.repeat && e.code !== 'Space') return
      switch (e.code) {
        case 'Digit1':
          this.setColor(0)
          break
        case 'Digit2':
          this.setColor(1)
          break
        case 'Digit3':
          this.setColor(2)
          break
        case 'KeyD':
          this.cycleDrawMode()
          break
        case 'KeyG':
          this.toggleGuide()
          break
        case 'KeyT':
          this.cycleTemplate()
          break
        case 'KeyC':
          this.clear()
          break
        case 'Space':
          this.spaceHeld = true
          e.preventDefault()
          break
        default:
          break
      }
    })
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceHeld = false
    })
  }

  _scheduleResize() {
    // Debounce a burst of resize events into a single reallocation next frame.
    if (this._resizePending) return
    this._resizePending = true
    requestAnimationFrame(() => {
      this._resizePending = false
      this._resize()
    })
  }

  _resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    this.pipeline.setSize(w, h)
    this.sampler.setViewport(w, h)
    this.sparkles.setViewport(w, h)
    this.sparkles.setPixelRatio(this.pipeline.getPixelRatio())
    this.guide.setAspect(w / h)
    this._recomputeCover()
  }

  _recomputeCover() {
    if (this.video.videoWidth > 0) {
      this.cover = coverTransform(
        window.innerWidth,
        window.innerHeight,
        this.video.videoWidth,
        this.video.videoHeight
      )
      this.pipeline.setCover(this.cover, this.mirror)
    }
  }

  /* ---- main loop --------------------------------------------------------- */

  _computePenDown(hand) {
    let desired
    if (this.drawMode === 'always') desired = hand.present
    else if (this.drawMode === 'held') desired = hand.present && this.spaceHeld
    else desired = hand.present && hand.pointing

    // Hysteresis to avoid flicker at the gesture threshold.
    const need = this.drawMode === 'gesture' ? 3 : 1
    if (desired) {
      this._downFrames++
      this._upFrames = 0
      if (this._downFrames >= need) this.penDown = true
    } else {
      this._upFrames++
      this._downFrames = 0
      if (this._upFrames >= need) this.penDown = false
    }
    return this.penDown
  }

  _loop(now) {
    if (!this.running) return
    const dt = Math.min((now - this._lastT) / 1000, 0.1)
    this._lastT = now

    // Cover can change once the first video frame arrives.
    if (this.cover.kx === 1 && this.cover.ky === 1 && this.video.videoWidth > 0) {
      this._recomputeCover()
    }

    const hand = this.tracker.detect(this.video, now)
    const isDown = this._computePenDown(hand)

    let tipClip = null
    if (isDown && hand.tip) {
      tipClip = fingertipToClip(hand.tip[0], hand.tip[1], this.cover, this.mirror)
    }

    const { segments, tip } = this.sampler.update(tipClip)
    this.pipeline.setSegments(segments)

    // Emit sparkles along accepted samples (fewer if reduced-motion).
    if (segments.length > 0 && tip) {
      this.sparkles.spawn(tip[0], tip[1], this.reducedMotion ? 1 : undefined)
    }

    this.sparkles.update(dt, now / 1000)
    this.guide.update(dt, !this.reducedMotion)
    this.pipeline.render(dt)

    this._updateHud(dt, hand, isDown)
    requestAnimationFrame((t) => this._loop(t))
  }

  _updateHud(dt, hand, isDown) {
    this._fpsAccum += dt
    this._fpsFrames++
    this._hudTick += dt
    if (this._hudTick < 0.4) return
    this._hudTick = 0
    const fps = Math.round(this._fpsFrames / this._fpsAccum)
    this._fpsAccum = 0
    this._fpsFrames = 0

    if (!hand.present) {
      this.ui.setStatus('Muestra tu mano ✋', 'warn')
    } else if (isDown) {
      this.ui.setStatus(`Dibujando ✨ · ${fps} fps`)
    } else {
      const tip =
        this.drawMode === 'gesture'
          ? 'Apunta con el índice ☝️'
          : this.drawMode === 'held'
            ? 'Mantén espacio para dibujar'
            : 'Mano detectada'
      this.ui.setStatus(`${tip} · ${fps} fps`)
    }
  }
}

// Boot.
window.addEventListener('DOMContentLoaded', () => {
  try {
    new App()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('No se pudo inicializar la app', err)
    const ui = document.getElementById('ui')
    if (!ui) return
    const msg = String(err?.message ?? err)
    const isWebGL = /webgl|context/i.test(msg)
    const title = isWebGL ? 'WebGL no disponible' : 'No se pudo iniciar'
    const body = isWebGL
      ? 'Tu navegador o dispositivo no soporta WebGL. Prueba en un navegador de escritorio reciente (Chrome, Edge, Firefox).'
      : 'Ocurrió un error al iniciar la aplicación. Recarga la página e inténtalo de nuevo.'
    const overlay = document.createElement('div')
    overlay.className = 'overlay error'
    const h = document.createElement('h1')
    h.textContent = title
    const p = document.createElement('p')
    p.textContent = body
    overlay.append(h, p)
    ui.replaceChildren(overlay)
  }
})
