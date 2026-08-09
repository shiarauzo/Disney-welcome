// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Webcam access. Wraps getUserMedia and resolves once the <video> element is
 * actually playing frames (so downstream code can safely read its dimensions).
 */

/**
 * Start the webcam and bind it to the given <video> element.
 * @param {HTMLVideoElement} video
 * @returns {Promise<HTMLVideoElement>}
 */
export async function startCamera(video) {
  // getUserMedia is only available in secure contexts. localhost counts as
  // secure; a plain-http deploy does not — give an accurate message.
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new CameraError(
      'insecure',
      'La cámara necesita una conexión segura (HTTPS). Abre el sitio por HTTPS o en localhost.'
    )
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(
      'unsupported',
      'Tu navegador no soporta acceso a la cámara (getUserMedia).'
    )
  }

  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        // Detections can't arrive faster than the camera delivers frames, and
        // a longer exposure per frame is what smears the fingers during a quick
        // stroke — the exact moment hand tracking drops out. Ask for 60; it's
        // an `ideal`, so a 30 fps webcam simply keeps what it had.
        frameRate: { ideal: 60 }
      }
    })
  } catch (err) {
    throw mapGetUserMediaError(err)
  }

  video.srcObject = stream

  await new Promise((resolve) => {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      resolve()
      return
    }
    video.addEventListener('loadeddata', () => resolve(), { once: true })
  })

  // Some browsers need an explicit play() after srcObject is set.
  try {
    await video.play()
  } catch {
    /* autoplay policies: the muted+autoplay attributes usually cover this */
  }

  if (import.meta.env.DEV) {
    const s = stream.getVideoTracks()[0]?.getSettings?.()
    // What we asked for and what we got are often different things, and the
    // real frame rate is the ceiling on how fast a stroke can be tracked.
    // eslint-disable-next-line no-console
    console.info('[camera]', s?.width, 'x', s?.height, '@', s?.frameRate, 'fps')
  }

  return video
}

export class CameraError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CameraError'
    this.code = code
  }
}

function mapGetUserMediaError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError(
        'denied',
        'Permiso de cámara denegado. Actívalo en el candado de la barra de direcciones y recarga.'
      )
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError(
        'not-found',
        'No se encontró ninguna cámara conectada.'
      )
    case 'NotReadableError':
      return new CameraError(
        'in-use',
        'La cámara está en uso por otra aplicación. Ciérrala e intenta de nuevo.'
      )
    default:
      return new CameraError('unknown', `No se pudo abrir la cámara: ${err?.message ?? err}`)
  }
}
