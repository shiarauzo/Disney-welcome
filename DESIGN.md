# DESIGN.md — Arquitectura de Finger Sparkle

Documento de diseño canónico. Explica **por qué** el proyecto está construido
así y **cómo** encajan las piezas. Si vas a tocar el render, empieza aquí.

## 1. Objetivo

Una experiencia 100% visual y client-side donde el usuario dibuja en el aire con
la punta del índice y deja un rastro neón con destellos que **persiste unos
segundos y se desvanece**, sobre el video en vivo de su cámara. El glow debe
usar **WebGL + shaders** (requisito duro). Homenaje _fan_ al bumper de la varita
mágica.

## 2. Flujo de datos

```
getUserMedia ─► <video> (oculto) ─┬─► THREE.VideoTexture ───────────────┐
                                  │                                     │
                                  └─► HandLandmarker.detectForVideo      │
                                          │ landmark[8] (norm 0..1)      │
                                          ▼                              │
                                   gesto "apuntar" (handTracking.js)     │
                                          │ isDown                       │
                                          ▼                              │
                                   fingertipToClip (coords.js)           │
                                          │ punto en clip space          │
                                          ▼                              │
                                   TrailSampler (trail.js)               │
                                     suaviza + samplea → segmentos       │
                        ┌──────────────────┴───────────┐                │
                        ▼                               ▼                ▼
                  SparkleSystem                  RenderPipeline (render/pipeline.js)
                  (chispas GPU)                  1. FeedbackPass: prev * fade
                        │                        2. DrawPass: segmentos SDF (aditivo)
                        │                        3. CompositePass: video+glow+bloom
                        └──────────► overlays ──► 4. chispas + guía (aditivo)
```

Un único bucle `requestAnimationFrame` (`main.js → App._loop`) orquesta todo.
MediaPipe corre en el mismo bucle con `detectForVideo(video, performance.now())`.

## 3. Pipeline de render: por qué feedback en FBO

Se evaluaron tres estrategias para el rastro persistente:

| Estrategia | Persistencia temporal | Suavidad | Rendimiento |
| --- | --- | --- | --- |
| **(a) Feedback FBO ping-pong + decay** ✅ | decaimiento exponencial = exacto y ajustable | campo raster continuo, sin costuras | **coste constante** por frame |
| (b) Geometría de línea con edad por vértice | fade barato | costuras en giros/velocidad, glow volumétrico difícil | geometría crece sin límite |
| (c) Point sprites aditivos | fade por edad | huecos con movimiento rápido | GC de partículas |

**Elegido: híbrido con (a) como base + emisor de segmentos "cápsula" de (b).**

- Dos render targets `HalfFloat` (si el GPU lo soporta; si no, `UnsignedByte`)
  que se intercambian cada frame.
- Cada frame: `nuevo = previo * fade + tinta_nueva`.
  - `fade = pow(0.015, dt / persistSeconds)` → **independiente del framerate** y
    calibrado para llegar a ~1.5% tras `persistSeconds` (3 s por defecto).
- La "tinta nueva" no son puntos: son **segmentos** entre muestras consecutivas
  del dedo, dibujados como un quad por segmento donde el fragment shader evalúa
  la **distancia a la línea (SDF de cápsula)** → núcleo caliente + halo suave.
  Esto da trazos sin huecos a cualquier velocidad y acumulación aditiva natural
  en los cruces. Coste por frame ~constante (2 pasadas fullscreen + unos quads).

Ver `src/shaders.js` (`SEGMENT_FRAG`, `FEEDBACK_FRAG`, `COMPOSITE_FRAG`).

## 4. Espacios de coordenadas (la zona de mayor riesgo)

Todo el mapeo vive en **`coords.js`** para que la entrada del dedo y el sampleo
del video en el shader **no puedan divergir** (bug clásico: "el glow no cae
sobre mi dedo").

- **Image UV** (MediaPipe): `[0,1]`, origen arriba-izquierda.
- **Screen UV** (top-left): `[0,1]`, origen arriba-izquierda del canvas.
- **Clip / NDC**: `[-1,1]`, origen centro, **y hacia arriba** (lo que usa la
  geometría).

Detalles:
- **Espejo (selfie):** se aplica en **un solo lugar**. El video se voltea en el
  `COMPOSITE_FRAG` (`img.x = 1 - img.x`) y el dedo se voltea en
  `fingertipToClip`. El `<canvas>` **no** se voltea por CSS (voltearía también el
  trazo y desincronizaría la entrada).
- **Cover:** `coverTransform()` calcula el ajuste "cover" (llena la pantalla,
  recorta el sobrante) como `imageUV = screenUV·(kx,ky) + (ox,oy)`. El shader lo
  usa hacia adelante; `fingertipToClip` usa el inverso. **Una sola función,
  cero drift.**
- **DPR:** `renderer.setPixelRatio(min(devicePixelRatio, 2))`; los targets se
  dimensionan en px de dispositivo. El SDF trabaja en px reales → glow circular.
- **Resize:** `App._resize()` reajusta renderer, targets, viewport del sampler y
  de las chispas, aspecto de la guía y recomputa el cover.

## 5. Gesto "pen down"

En `handTracking.js#isPointing`, sobre los 21 landmarks de MediaPipe:
- **Índice extendido:** `dist(tip8, wrist) > dist(pip6, wrist)` (robusto a
  rotación).
- **Otros dedos curvados:** medio/anular/meñique con `dist(tip, wrist) <
  dist(pip, wrist)`; se exigen ≥2 de 3 para tolerar ruido.
- `isDown = índiceExtendido && otrosCurvados`.

En `main.js#_computePenDown` se añade **histéresis** (N frames para activar/
desactivar) y **modos**: `gesture` (por defecto), `held` (barra espaciadora) y
`always`. Sin mano detectada → siempre pen-up.

Suavizado del dedo: exponencial en `trail.js` (`CONFIG.trail.smoothing`), más
rechazo de "teletransportes" (saltos de tracking) y descarte del último punto en
pen-up para no dibujar una línea puente.

## 6. Shaders

Todos en `src/shaders.js` como strings (sin plugin de Vite).

- **`SEGMENT_VERT/FRAG`** — quad por segmento; el fragment convierte clip→px,
  calcula SDF de cápsula, compone núcleo (casi blanco) + halo exponencial.
  Blending aditivo hacia el buffer de acumulación.
  Uniforms: `uResolution, uColor, uGlowColor, uCoreRadius, uGlowRadius,
  uGlowFalloff, uCoreGain, uGlowGain, uIntensity`.
- **`FEEDBACK_FRAG`** — `prev * uFade`. `uFade` se calcula en CPU desde `dt`.
- **`COMPOSITE_FRAG`** — video (cover+espejo) + tinta + bloom de 8 taps +
  tone-map Reinhard. Uniforms: `uVideo, uTrail, uTexel, uCover, uMirror,
  uBloomStrength, uBloomRadius, uCamDim`.
- **`SPARKLE_VERT/FRAG`** — point sprites con edad/vida, parpadeo (twinkle) y
  forma de estrella de 4 puntas. Aditivo.
- **`GUIDE_VERT/FRAG`** — líneas de la plantilla, color + opacidad pulsante.

## 7. Chispas (homenaje al polvo de varita)

`sparkles.js`: pool de tamaño fijo (`CONFIG.sparkles.max`) con ring buffer. Cada
muestra aceptada del trazo emite `perSample` partículas cerca de la punta, con
vida, tamaño, semilla y velocidad de ascenso aleatorias. Se actualizan en CPU
(edad + deriva) y se renderizan aditivas encima del composite. Las muertas
quedan con `life=0` → `alpha=0` → descartadas en el shader.

## 8. Guía de trazado

`templates.js`: plantillas como polilíneas en un espacio unitario centrado,
horneadas a clip space con corrección de aspecto (`_rebuild`, con un buffer
preasignado que se reutiliza para no fugar VBOs al redimensionar). Formas
incluidas: **Orejas** (tres círculos), **Estrella**, **Corazón**, **Flor** y
**Espiral** — contornos geométricos simples, sin logos ni recursos de marca (ver
el aviso de homenaje fan en el README). Pulso suave de opacidad para indicar que
está activa; el pulso se desactiva con `prefers-reduced-motion`.

## 9. Rendimiento y robustez

| Riesgo | Mitigación |
| --- | --- |
| Carga de WASM + modelo `.task` | Estado "Cargando…"; se hace `await` antes del bucle. Modelo desde CDN de MediaPipe. |
| Permiso de cámara denegado / sin cámara / origen inseguro | `CameraError` tipado → overlay accionable. |
| Sin mano detectada | pen-up forzado; el rastro sigue decayendo; chip "Muestra tu mano". |
| FPS bajo | DPR ≤ 2; delegado GPU en MediaPipe; coste de render constante. |
| Sin soporte float | `FeedbackTarget` detecta la extensión y cae a `UnsignedByte`. |
| Jitter del dedo / parpadeo del gesto | suavizado + histéresis de N frames. |
| Timestamp duplicado en MediaPipe | se salta el frame si `video.currentTime` no avanzó. |
| Sin WebGL | overlay de error en el arranque. |

## 10. Estructura de archivos

```
src/
  main.js            App: bucle rAF, estado, teclado, resize, modos de pen
  config.js          TODOS los ajustes (paleta, decay, radios, umbrales)
  camera.js          getUserMedia + errores tipados
  handTracking.js    HandLandmarker + gesto "apuntar"
  coords.js          mapeo cover/espejo/clip (única fuente de verdad)
  trail.js           suavizado + muestreo → segmentos
  sparkles.js        sistema de partículas (chispas)
  templates.js       guías de trazado (orejas/estrella/corazón)
  shaders.js         todo el GLSL
  ui.js              overlay, barra de controles, HUD
  style.css          estilos de la UI
  render/
    pipeline.js      orquesta las pasadas (feedback→draw→composite→overlays)
    FeedbackTarget.js  par de render targets ping-pong
```

## 11. Convenciones

- **`config.js` es la única fuente de números mágicos.** No los esparzas por el
  render.
- **El espejo se aplica solo en `coords.js` + `COMPOSITE_FRAG`.**
- Toda la geometría se autora en **clip space**; se usa una cámara identidad.
- El GLSL vive en `src/shaders.js`.
- Cabecera SPDX `// SPDX-License-Identifier: AGPL-3.0-or-later` en cada fuente.
