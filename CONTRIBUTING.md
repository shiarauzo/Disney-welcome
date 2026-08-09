# Contribuir a Finger Sparkle ✨

¡Gracias por tu interés! Este es un proyecto visual, abierto y colaborativo bajo
**AGPL-3.0**. Toda contribución es bienvenida: código, ideas, figuras de guía,
mejoras de shaders, accesibilidad, traducciones o reportes de bugs.

## Requisitos

- Node 18+
- Un navegador de escritorio moderno con WebGL2 y cámara

## Puesta en marcha

```bash
git clone https://github.com/<tu-usuario>/Disney-welcome.git
cd Disney-welcome
npm install
npm run dev
```

## Flujo de trabajo

1. Haz un **fork** y crea una rama descriptiva: `feat/…`, `fix/…`, `docs/…`.
2. Haz tus cambios siguiendo el estilo del repo (ver abajo).
3. **`npm run build` debe pasar** y la app debe correr con `npm run dev`
   (prueba la cámara y el trazo — no hay tests automáticos).
4. Abre un **Pull Request** describiendo qué cambia y por qué. Adjunta un
   GIF/screenshot si es un cambio visual — ayuda muchísimo.

## Estilo de código

- ES modules, JavaScript moderno. Sigue el estilo existente (comillas simples,
  sin `;` innecesarios, funciones pequeñas y comentadas).
- **Respeta las reglas de `CLAUDE.md`**, en especial:
  - `config.js` es la única fuente de ajustes/números mágicos.
  - El espejo se aplica solo en `coords.js` + `COMPOSITE_FRAG`.
  - Toda la geometría en clip space; GLSL en `src/shaders.js`.
- Añade la cabecera SPDX a cada archivo fuente nuevo:

  ```js
  // SPDX-License-Identifier: AGPL-3.0-or-later
  ```

## Añadir una figura de guía

Edita `TEMPLATES` en `src/templates.js`. Cada figura es una lista de polilíneas
en el espacio unitario centrado (`~[-1.1, 1.1]`, y arriba). Usa **solo geometría
genérica original** — nada de marcas registradas.

## Añadir un color

Agrega una entrada a `PALETTE` en `src/config.js` (`{ name, main, glow }` con RGB
en `0..1`). La UI y los atajos se adaptan solos.

## Reportar bugs

Usa las plantillas de _issues_. Incluye navegador, sistema operativo y pasos para
reproducir. Para bugs visuales, un GIF vale oro.

## Licencia de tus contribuciones

Al contribuir aceptas que tu código se publique bajo **AGPL-3.0-or-later**, la
misma licencia del proyecto.
