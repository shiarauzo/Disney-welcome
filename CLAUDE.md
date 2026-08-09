# CLAUDE.md

Guía para agentes de IA (y humanos nuevos) que trabajen en este repo.

## Qué es

**Finger Sparkle** — app web 100% visual y client-side. Dibujas en el aire con
la punta del índice y dejas un rastro neón con destellos que persiste y se
desvanece, sobre el video de tu cámara. Homenaje _fan no oficial_ al bumper de
la varita mágica (sin marcas ni recursos de Disney).

Stack: **Three.js + WebGL + shaders GLSL** (glow), **MediaPipe Tasks Vision**
(hand tracking), **Vite** (build). Sin backend.

## Comandos

```bash
npm install      # dependencias
npm run dev      # dev server (http://localhost:5173)
npm run build    # build de producción -> dist/
npm run preview  # sirve el build
```

No hay tests automatizados: es un proyecto visual. **Verifica los cambios
corriendo `npm run dev`** y probando la cámara + el trazo. `npm run build` debe
pasar siempre antes de commitear.

## Arquitectura (lee DESIGN.md para el detalle)

Bucle: `main.js` → cámara → `handTracking.js` (punta del índice + gesto) →
`coords.js` (mapeo a clip) → `trail.js` (muestreo → segmentos) →
`render/pipeline.js` (feedback FBO → segmentos SDF → composite → overlays).

El rastro persistente = **buffer de acumulación ping-pong**: cada frame
`nuevo = previo * fade + tinta_nueva`, con la tinta dibujada como segmentos
cápsula (SDF en el fragment shader). Ver `src/shaders.js`.

## Reglas del repo (importantes)

1. **`config.js` es la única fuente de ajustes.** Paleta, decay, radios,
   umbrales del gesto, etc. No metas números mágicos en el render.
2. **El espejo (selfie) se aplica SOLO en dos sitios coordinados:**
   `coords.js#fingertipToClip` y `COMPOSITE_FRAG`. Nunca voltees el `<canvas>`
   por CSS.
3. **Todo el mapeo de coordenadas vive en `coords.js`.** Entrada del dedo y
   sampleo del video derivan del mismo `coverTransform` → no pueden divergir.
4. **Toda la geometría se autora en clip space** (`[-1,1]`, y arriba). Se usa una
   cámara identidad; pon `frustumCulled = false` en objetos nuevos.
5. **El GLSL vive en `src/shaders.js`** como strings (no hay loader de `.glsl`).
6. **Cabecera SPDX** en cada archivo fuente:
   `// SPDX-License-Identifier: AGPL-3.0-or-later`.
7. **Nada de backend ni de subir datos.** La cámara se queda en el dispositivo.
8. **Homenaje seguro:** no añadas logos, marcas, nombres ni recursos de Disney.
   Las guías son formas geométricas genéricas.

## Licencia

**AGPL-3.0-or-later.** Los derivados —incluidos servicios web— deben publicar su
código bajo la misma licencia. Mantén la cabecera SPDX en fuentes nuevas.
