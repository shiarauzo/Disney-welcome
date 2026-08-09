// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * All GLSL for the project, kept as tagged template strings so no Vite plugin
 * or loader is required. Each pass documents its role and uniforms.
 */

/** Shared full-screen quad vertex shader. Emits vUv in [0,1], y up. */
export const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/* -------------------------------------------------------------------------- */
/* DrawPass: capsule-SDF neon segment                                          */
/* -------------------------------------------------------------------------- */

/**
 * Segment vertex shader. Geometry is authored directly in clip space; we pass
 * the segment endpoints (also clip space) through to the fragment shader.
 * Attributes aStart/aEnd are constant across the 4 verts of each segment quad.
 */
export const SEGMENT_VERT = /* glsl */ `
  attribute vec2 aStart;
  attribute vec2 aEnd;
  varying vec2 vClip;
  varying vec2 vStart;
  varying vec2 vEnd;
  void main() {
    vClip = position.xy;
    vStart = aStart;
    vEnd = aEnd;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/**
 * Segment fragment shader — the visual signature. Computes the pixel distance
 * to the line segment (a capsule SDF) and builds a hot core + soft neon halo.
 * Rendered with additive blending into the accumulation buffer.
 *
 * Uniforms: uResolution, uColor, uGlowColor, uCoreRadius, uGlowRadius,
 *           uGlowFalloff, uCoreGain, uGlowGain, uIntensity.
 */
export const SEGMENT_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vClip;
  varying vec2 vStart;
  varying vec2 vEnd;
  uniform vec2 uResolution;
  uniform vec3 uColor;
  uniform vec3 uGlowColor;
  uniform float uGlowRadius;
  uniform float uCoreGain;
  uniform float uInnerGain;
  uniform float uOuterGain;
  uniform float uCoreSharpness;
  uniform float uInnerSharpness;
  uniform float uOuterFalloff;
  uniform float uIntensity;
  uniform float uTime;

  // Clip [-1,1] -> pixel coordinates.
  vec2 toPx(vec2 clip) { return (clip * 0.5 + 0.5) * uResolution; }

  float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * h);
  }

  void main() {
    vec2 p = toPx(vClip);
    float d = segDist(p, toPx(vStart), toPx(vEnd));
    float x = d / max(uGlowRadius, 1e-3); // distance in radius units

    // Real light = white-hot core + saturated hue ring + wide soft halo.
    float core  = exp(-x * x * uCoreSharpness);
    float inner = exp(-x * x * uInnerSharpness);
    float outer = exp(-x * uOuterFalloff);

    vec3 col = vec3(1.0) * (core * uCoreGain);   // pure white core -> reads as light
    col += uColor * (inner * uInnerGain);        // the hue
    col += uGlowColor * (outer * uOuterGain);    // pale soft bleed

    // Subtle temporal shimmer so the light "breathes" instead of sitting static.
    float shimmer = 0.92 + 0.08 * sin(uTime * 20.0 + (vStart.x + vStart.y) * 40.0);
    gl_FragColor = vec4(col * uIntensity * shimmer, 1.0);
  }
`

/* -------------------------------------------------------------------------- */
/* FeedbackPass: decay the previous accumulation frame                         */
/* -------------------------------------------------------------------------- */

/**
 * Multiplies the previous accumulation frame by a per-frame fade factor so the
 * trail persists then fades. uFade is precomputed on the CPU from dt so the
 * fade is frame-rate independent.
 */
export const FEEDBACK_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPrev;
  uniform float uFade;
  void main() {
    vec3 prev = texture2D(uPrev, vUv).rgb;
    // Self-heal: a NaN texel would feedback forever (NaN * fade = NaN) and
    // corrupt the trail permanently. x != x is true only for NaN (ES1-safe);
    // clamp also tames any Inf. Combined with input sanitization this makes a
    // poisoned buffer impossible.
    if (prev.r != prev.r) prev.r = 0.0;
    if (prev.g != prev.g) prev.g = 0.0;
    if (prev.b != prev.b) prev.b = 0.0;
    prev = clamp(prev, 0.0, 1000.0);
    gl_FragColor = vec4(prev * uFade, 1.0);
  }
`

/* -------------------------------------------------------------------------- */
/* CompositePass: video + trail + cheap bloom                                  */
/* -------------------------------------------------------------------------- */

/**
 * Blends the mirrored, cover-fit webcam with the accumulated neon trail and a
 * cheap multi-tap bloom. Reinhard tone-map keeps hot cores from clipping ugly.
 *
 * Uniforms: uVideo, uTrail, uTexel, uCover(kx,ky,ox,oy), uMirror,
 *           uBloomStrength, uBloomRadius, uCamDim.
 */
export const COMPOSITE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVideo;
  uniform sampler2D uTrail;
  uniform vec2 uTexel;
  uniform vec4 uCover;   // kx, ky, ox, oy
  uniform float uMirror; // 1.0 = mirrored
  uniform float uBloomStrength;
  uniform float uBloomRadius;
  uniform float uCamDim;
  uniform float uGlowExposure;
  uniform float uSurroundDim;

  vec3 sampleTrail(vec2 uv) { return texture2D(uTrail, uv).rgb; }

  // One 8-tap ring at radius r, weighted.
  vec3 bloomRing(float r, float w) {
    vec3 s = vec3(0.0);
    s += sampleTrail(vUv + uTexel * vec2( r, 0.0));
    s += sampleTrail(vUv + uTexel * vec2(-r, 0.0));
    s += sampleTrail(vUv + uTexel * vec2(0.0,  r));
    s += sampleTrail(vUv + uTexel * vec2(0.0, -r));
    s += sampleTrail(vUv + uTexel * vec2( r,  r) * 0.707);
    s += sampleTrail(vUv + uTexel * vec2(-r,  r) * 0.707);
    s += sampleTrail(vUv + uTexel * vec2( r, -r) * 0.707);
    s += sampleTrail(vUv + uTexel * vec2(-r, -r) * 0.707);
    return s * (w * 0.125);
  }

  // ACES filmic tone-map: rolls hot highlights toward white (light, not paint).
  vec3 aces(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }

  void main() {
    // Screen UV in top-left origin for the cover math.
    vec2 suv = vec2(vUv.x, 1.0 - vUv.y);
    vec2 img = suv * uCover.xy + uCover.zw;
    if (uMirror > 0.5) img.x = 1.0 - img.x;
    vec3 cam = texture2D(uVideo, img).rgb;

    vec3 ink = sampleTrail(vUv);

    // Multi-scale bloom: three rings (tight + medium + wide) for a soft,
    // film-like halo instead of a single hard ring.
    vec3 bloom = bloomRing(uBloomRadius, 0.5);
    bloom += bloomRing(uBloomRadius * 3.0, 0.32);
    bloom += bloomRing(uBloomRadius * 8.0, 0.18);
    bloom *= uBloomStrength;

    vec3 glow = ink + bloom;
    vec3 glowMapped = aces(glow * uGlowExposure);

    // Real bloom appears to darken its surround -> local contrast so the glow
    // stays punchy even over a bright camera image (no hard vignette).
    float haloLum = dot(bloom, vec3(0.299, 0.587, 0.114));
    float dim = 1.0 - uSurroundDim * clamp(haloLum, 0.0, 1.0);

    vec3 outc = cam * uCamDim * dim + glowMapped;
    gl_FragColor = vec4(outc, 1.0);
  }
`

/* -------------------------------------------------------------------------- */
/* Sparkles: additive twinkling point sprites                                  */
/* -------------------------------------------------------------------------- */

/**
 * Point-sprite vertex shader. Per-particle attributes drive size, age fade and
 * twinkle. Positions are authored in clip space.
 * Attributes: aBirthLife(birthAge, life), aSize, aSeed.
 * Uniforms: uTime, uPixelRatio.
 */
export const SPARKLE_VERT = /* glsl */ `
  attribute vec2 aBirthLife; // x = age already elapsed at build, y = life
  attribute float aSize;
  attribute float aSeed;
  varying float vAlpha;
  varying float vSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  void main() {
    float life = max(aBirthLife.y, 0.0001);
    float age = aBirthLife.x;
    float t = clamp(age / life, 0.0, 1.0);
    // Fade in fast, out slow.
    vAlpha = smoothstep(0.0, 0.12, t) * (1.0 - t) * (1.0 - t);
    vSeed = aSeed;
    float twinkle = 0.6 + 0.4 * sin(uTime * (6.0 + aSeed * 10.0) + aSeed * 42.0);
    // A few rare "hero" sparkles are larger, so the field doesn't look uniform.
    float hero = step(0.9, fract(aSeed * 13.0));
    gl_PointSize = aSize * uPixelRatio * (0.6 + 0.7 * twinkle) * (1.0 + hero) * (vAlpha > 0.0 ? 1.0 : 0.0);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/**
 * Point-sprite fragment shader — a four-point sparkle (star) with a bright
 * core, tinted by the active color and rendered additively.
 * Uniforms: uColor, uGlowColor.
 */
export const SPARKLE_FRAG = /* glsl */ `
  precision highp float;
  varying float vAlpha;
  varying float vSeed;
  uniform vec3 uColor;
  uniform vec3 uGlowColor;
  void main() {
    if (vAlpha <= 0.0) discard;
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float dist = length(uv);
    // Round soft glow.
    float glow = exp(-dist * dist * 4.0);
    // Star spikes with per-particle length so the field isn't uniform.
    float spikeLen = mix(3.0, 9.0, fract(vSeed * 7.0));
    float spikes = 0.0;
    spikes += pow(max(0.0, 1.0 - abs(uv.x) * spikeLen), 2.0) * max(0.0, 1.0 - abs(uv.y));
    spikes += pow(max(0.0, 1.0 - abs(uv.y) * spikeLen), 2.0) * max(0.0, 1.0 - abs(uv.x));
    // Hot white center; magic dust is closer to white-gold than a flat hue.
    float core = smoothstep(0.18, 0.0, dist);
    vec3 tint = mix(uGlowColor, vec3(1.0), 0.5);
    vec3 col = tint * (glow * 0.5 + spikes * 0.9) + vec3(1.0) * core * 0.9;
    gl_FragColor = vec4(col * vAlpha, 1.0);
  }
`

/* -------------------------------------------------------------------------- */
/* Guide: faint trace-template lines                                           */
/* -------------------------------------------------------------------------- */

export const GUIDE_VERT = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export const GUIDE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  // Additive blending contributes src.rgb * src.a, so keep alpha at 1.0 and
  // bake the opacity into rgb once (otherwise it would be applied twice).
  void main() { gl_FragColor = vec4(uColor * uOpacity, 1.0); }
`
