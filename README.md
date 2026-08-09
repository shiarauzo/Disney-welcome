# ✨ Finger Sparkle

Dibuja en el aire con tu **dedo índice** y deja un rastro de luz neón con
destellos que persiste unos segundos y se desvanece solo. Un homenaje _fan_ al
clásico bumper de la varita mágica de la tele — pero hecho con tu dedo.

**100% visual · 100% en el navegador · la cámara nunca sale de tu dispositivo.**

Construido con **Three.js + WebGL + shaders GLSL** para el glow, y
**MediaPipe Hands** para seguir la punta de tu dedo en tiempo real.

> ⚠️ **Aviso:** proyecto artístico y educativo, homenaje _fan no oficial_. No
> está afiliado, patrocinado ni respaldado por The Walt Disney Company, ni usa
> sus logos, nombres, marcas ni recursos. Las guías de trazado son simples
> contornos geométricos que tú dibujas con el dedo; tú eres responsable de lo
> que dibujes.

---

## 🎬 Qué hace

- Enciende la cámara y detecta la punta de tu **índice**.
- Al **apuntar** con el índice, dibuja un trazo con **glow** que brilla y suelta
  **chispas** (como polvo de varita mágica).
- El trazo **persiste ~3 segundos** y se desvanece suavemente (feedback en GPU).
- Cambia el color en vivo: **amarillo**, **rosa** o **morado**.
- **Modo guía**: sigue una silueta tenue (orejas, estrella, corazón, flor o
  espiral) para "trazarla" con el dedo.

## 🚀 Empezar

Requisitos: Node 18+ y un navegador de escritorio moderno con WebGL2 y cámara.

```bash
npm install
npm run dev        # abre http://localhost:5173
```

Para producción:

```bash
npm run build      # genera dist/
npm run preview    # sirve el build localmente
```

> La cámara (`getUserMedia`) solo funciona sobre **HTTPS** o en **localhost**.
> GitHub Pages sirve por HTTPS, así que el deploy funciona sin configuración
> extra.

> **Requisito de red:** el modelo de detección de manos y su runtime WASM se
> descargan desde un CDN (jsDelivr + Google) la **primera vez**. Si un firewall,
> bloqueador o el modo offline impiden ese acceso, la app avisará con un mensaje
> claro. El resto (Three.js, tu código) se sirve desde el propio sitio.

## 🌐 Desplegar

El repo trae `vercel.json` y el `base` de Vite por defecto es `/`, así que
funciona en la **raíz** de un dominio.

**Vercel (recomendado):**
1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** →
   `shiarauzo/Disney-welcome`.
2. Framework: **Vite** (autodetectado) · Build: `npm run build` · Output: `dist`.
3. **Deploy**. Vercel es HTTPS, así que la cámara funciona sin más.

O con la CLI: `npm i -g vercel && vercel --prod`.

**GitHub Pages:** ya hay un workflow (`.github/workflows/deploy.yml`) que
construye con `BASE_PATH=/Disney-welcome/` y publica en cada push a `main`
(activa Pages con *Source: GitHub Actions*).

## 🎮 Controles

| Acción | Ratón / Botón | Teclado |
| --- | --- | --- |
| Cambiar color | Círculos de color | `1` `2` `3` |
| Modo de dibujo | Botón "Modo" | `D` |
| Guía de trazado on/off | Botón "Guía" | `G` |
| Cambiar figura de guía | Botón "Figura" | `T` |
| Limpiar el lienzo | Botón "Limpiar" | `C` |
| Dibujar (modo "Mantener") | — | mantén `Espacio` |

**Modos de dibujo:**
- **Gesto ☝️** (por defecto): dibuja solo cuando apuntas con el índice y curvas
  los demás dedos.
- **Mantener ␣**: dibuja mientras mantienes la barra espaciadora (solo en
  dispositivos con teclado; se oculta en pantallas táctiles).
- **Siempre**: dibuja siempre que se detecte una mano.

## 🧠 Cómo funciona (resumen)

```
Cámara ─► <video> ─┬─► textura de video ─────────────────┐
                   └─► MediaPipe HandLandmarker           │
                          │ (punta del índice = landmark 8)│
                          ▼                                ▼
                    gesto + suavizado            Pipeline WebGL:
                          │                      1. decay del frame previo (FBO)
                          ▼                      2. dibuja segmentos glow (SDF)
                    muestreo del trazo  ───────► 3. composite: video + glow + bloom
                                                 4. chispas + guía encima
```

El glow persistente se logra con un **buffer de acumulación ping-pong** que cada
frame multiplica el frame anterior por un factor de decaimiento y suma los
nuevos segmentos (dibujados como cápsulas con un _SDF_ en el fragment shader).
Todos los detalles están en **[DESIGN.md](./DESIGN.md)**.

## 🛠️ Stack

- [Three.js](https://threejs.org/) — WebGL + render targets + shaders
- [MediaPipe Tasks Vision](https://developers.google.com/mediapipe) — hand tracking
- [Vite](https://vitejs.dev/) — dev server y build

## 🤝 Contribuir

¡Se aceptan PRs! Lee **[CONTRIBUTING.md](./CONTRIBUTING.md)** para el flujo de
trabajo y el estilo de código.

## 📄 Licencia

**[AGPL-3.0-or-later](./LICENSE)**. Puedes ver, usar, modificar y compartir el
código libremente, pero **cualquier trabajo derivado —incluido un servicio web—
debe publicar su código fuente bajo la misma licencia**. Así la gente puede
colaborar sin que nadie se lleve el código a un producto cerrado.

Si despliegas una versión modificada accesible por red, la AGPL (§13) te obliga
a ofrecer el código fuente a sus usuarios.
