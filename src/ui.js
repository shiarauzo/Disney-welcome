// SPDX-License-Identifier: AGPL-3.0-or-later
import { PALETTE } from './config.js'

const DRAW_MODE_LABELS = {
  gesture: 'Gesto ☝️',
  held: 'Mantener ␣',
  always: 'Siempre'
}

const rgbCss = (c) =>
  `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`

/**
 * All DOM UI: the intro/error overlay, the control bar, the HUD chips and the
 * keyboard-hint card. Communicates via the `handlers` callbacks; the app owns
 * the state and calls the setters back.
 */
export class UI {
  /**
   * @param {HTMLElement} root
   * @param {{
   *   onStart:Function, onColor:Function, onCycleDrawMode:Function,
   *   onToggleGuide:Function, onCycleTemplate:Function, onClear:Function
   * }} handlers
   */
  constructor(root, handlers) {
    this.root = root
    this.h = handlers
    this._build()
  }

  _build() {
    // Intro overlay.
    this.overlay = el('div', 'overlay')
    this.overlay.innerHTML = `
      <h1>✨ Finger Sparkle</h1>
      <p>Dibuja en el aire con tu <strong>dedo índice</strong> y deja un rastro
         de luz con destellos que se desvanece solo. Todo pasa en tu navegador:
         la cámara nunca sale de tu dispositivo.</p>
      <button class="cta">Encender cámara ✨</button>
      <p class="small">Necesita permiso de cámara · funciona mejor con buena luz</p>
    `
    this.overlay.querySelector('.cta').addEventListener('click', () => this.h.onStart())
    this.root.appendChild(this.overlay)

    // HUD.
    this.hud = el('div', 'hud')
    this.statusChip = el('div', 'chip')
    this.statusChip.textContent = 'Listo'
    this.hud.appendChild(this.statusChip)
    this.root.appendChild(this.hud)

    // Hint card.
    this.hint = el('div', 'hint')
    this.hint.innerHTML = `
      <strong>Cómo dibujar</strong><br>
      Apunta con el índice y muévelo. Curva los otros dedos.<br>
      <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> color ·
      <kbd>D</kbd> modo · <kbd>G</kbd> guía ·
      <kbd>T</kbd> figura · <kbd>C</kbd> limpiar
    `
    this.root.appendChild(this.hint)

    // Control bar.
    this.controls = el('div', 'controls hidden')

    this.swatches = PALETTE.map((color, i) => {
      const b = el('button', 'swatch')
      b.style.background = rgbCss(color.main)
      b.style.color = rgbCss(color.main)
      b.title = color.name
      b.setAttribute('aria-label', `Color ${color.name}`)
      b.addEventListener('click', () => this.h.onColor(i))
      this.controls.appendChild(b)
      return b
    })

    this.controls.appendChild(el('div', 'sep'))

    this.drawBtn = mkBtn('Gesto ☝️', () => this.h.onCycleDrawMode())
    this.guideBtn = mkBtn('Guía: off', () => this.h.onToggleGuide())
    this.templateBtn = mkBtn('Figura', () => this.h.onCycleTemplate())
    this.clearBtn = mkBtn('Limpiar', () => this.h.onClear())
    this.controls.append(this.drawBtn, this.guideBtn, this.templateBtn, this.clearBtn)

    this.root.appendChild(this.controls)
  }

  /* ---- state setters ----------------------------------------------------- */

  hideOverlay() {
    this.overlay.classList.add('hidden')
    this.controls.classList.remove('hidden')
  }

  showError(title, message) {
    this.overlay.classList.remove('hidden')
    this.overlay.classList.add('error')
    this.overlay.replaceChildren()
    const h = el('h1')
    h.textContent = title
    const p = el('p')
    p.textContent = message // textContent: never interpret error text as HTML
    const btn = el('button', 'cta')
    btn.textContent = 'Reintentar'
    btn.addEventListener('click', () => location.reload())
    this.overlay.append(h, p, btn)
  }

  setStatus(text, kind = '') {
    this.statusChip.textContent = text
    this.statusChip.className = `chip ${kind}`
  }

  setColorActive(index) {
    this.swatches.forEach((s, i) => s.classList.toggle('active', i === index))
  }

  setDrawMode(mode) {
    this.drawBtn.textContent = DRAW_MODE_LABELS[mode] ?? mode
  }

  setGuide(visible, templateName) {
    this.guideBtn.textContent = visible ? `Guía: ${templateName}` : 'Guía: off'
    this.guideBtn.classList.toggle('on', visible)
    this.templateBtn.classList.toggle('hidden', !visible)
  }
}

function el(tag, className) {
  const e = document.createElement(tag)
  if (className) e.className = className
  return e
}

function mkBtn(label, onClick) {
  const b = el('button', 'btn')
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}
