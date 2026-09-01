/**
 * Cliente HTTP del backend FastAPI.
 *
 * La URL base viene de EXPO_PUBLIC_API_URL (ver .env.example). Expo la inlinea
 * en el bundle, por eso hay que referenciarla con dot notation literal:
 * process.env['EXPO_PUBLIC_...'] o desestructurar NO funciona.
 */

import { auth } from './firebase';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

/** Timeout manual: sin esto, un fetch a una IP inalcanzable se cuelga ~1 min. */
const TIMEOUT_MS = 8000;

/**
 * Subir audio no se parece a pedir /health: son megas viajando por red móvil,
 * y el timeout corto de arriba cortaría subidas perfectamente sanas.
 */
const UPLOAD_TIMEOUT_MS = 60000;

function requireApiUrl(): string {
  if (!API_URL) {
    throw new Error(
      'Falta EXPO_PUBLIC_API_URL. Copia .env.example a .env y recarga la app.'
    );
  }
  return API_URL;
}

async function request(path: string): Promise<unknown> {
  const baseUrl = requireApiUrl();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} en ${path}`);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `Timeout tras ${TIMEOUT_MS / 1000}s al llamar a ${baseUrl}${path}. ` +
          '¿El backend sigue corriendo y el móvil está en la misma red?'
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** GET /health — comprueba que el backend responde. */
export function getHealth(): Promise<unknown> {
  return request('/health');
}

/**
 * Respuesta de POST /recordings (el `RecordingUploadResponse` del backend).
 *
 * Se mantienen los nombres en snake_case tal cual llegan por la red: traducir a
 * camelCase obligaría a una capa de mapeo que puede desincronizarse del schema
 * sin que TypeScript se entere.
 */
export type UploadedRecording = {
  /** `<uid>_<timestamp>_<aleatorio>`; con esto se pedirán luego transcripción y análisis. */
  recording_id: string;
  /** Nombre con el que el backend guardó el archivo. */
  filename: string;
  /** Tipo MIME normalizado, sin parámetros. */
  content_type: string;
  /** Tamaño real recibido, en bytes. */
  size_bytes: number;
};

/**
 * El backend elige la extensión con la que guarda a partir del content-type de
 * la parte multipart, no del nombre del archivo, así que este mapeo es lo que
 * de verdad decide si acepta o rechaza el audio.
 *
 * RecordingPresets.HIGH_QUALITY graba .m4a en iOS y Android, y .webm en web.
 */
const MIME_POR_EXTENSION: Record<string, string> = {
  m4a: 'audio/m4a',
  mp4: 'audio/mp4',
  webm: 'audio/webm',
};

/** Deduce nombre y tipo MIME de la parte multipart a partir de la URI local. */
function describirArchivo(uri: string): { name: string; type: string } {
  // Se corta por ? y # antes de mirar la extensión: la URI del recorder es un
  // file:// limpio, pero un query string colado dejaría "m4a?foo" como extensión.
  const ruta = uri.split(/[?#]/)[0] ?? '';
  const extension = ruta.split('.').pop()?.toLowerCase() ?? '';
  const type = MIME_POR_EXTENSION[extension];

  if (!type) {
    throw new Error(
      `No se reconoce el formato del audio (${extension ? `.${extension}` : 'sin extensión'}). ` +
        'El servidor solo acepta m4a, mp4 y webm.'
    );
  }

  return { name: `recording.${extension}`, type };
}

/** Token de Firebase para el header Authorization. */
async function obtenerToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('No hay sesión iniciada. Vuelve a entrar para subir la grabación.');
  }

  try {
    // getIdToken() refresca solo si el token está a punto de caducar; si la
    // sesión ya no vale, falla aquí en vez de provocar un 401 más adelante.
    return await user.getIdToken();
  } catch {
    throw new Error(
      'No se pudo validar tu sesión. Vuelve a iniciar sesión e inténtalo de nuevo.'
    );
  }
}

/**
 * Extrae el `detail` de un error de FastAPI: un string en los HTTPException que
 * lanza el router (401, 413, 415) y un array de objetos en los 422 de
 * validación. Si el cuerpo no es ninguna de las dos cosas devuelve null, y el
 * llamador se queda con el status, que es mejor que un mensaje inventado.
 */
async function extraerDetalle(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || !('detail' in body)) {
      return null;
    }

    const { detail } = body as { detail: unknown };

    if (typeof detail === 'string') {
      return detail;
    }

    if (Array.isArray(detail)) {
      const mensajes = detail
        .map((item) =>
          typeof item === 'object' && item !== null && 'msg' in item
            ? String((item as { msg: unknown }).msg)
            : null
        )
        .filter((msg): msg is string => msg !== null);
      return mensajes.length > 0 ? mensajes.join('; ') : null;
    }

    return null;
  } catch {
    // Cuerpo vacío o que no es JSON (p.ej. el HTML de error de un proxy).
    return null;
  }
}

/** Traduce el status a algo que se pueda enseñar tal cual en la pantalla. */
function mensajeDeError(status: number, detalle: string | null): string {
  switch (status) {
    case 401:
      // El detail del backend aquí es técnico ("token inválido o expirado"); al
      // usuario le sirve más saber qué tiene que hacer.
      return 'Tu sesión caducó. Vuelve a iniciar sesión e inténtalo de nuevo.';
    case 413:
      return detalle ?? 'La grabación supera el tamaño máximo permitido (25 MB).';
    case 415:
      return detalle ?? 'El servidor no acepta el formato de este audio.';
    case 422:
      return detalle ?? 'El servidor no encontró el archivo en la petición.';
    case 503:
      return (
        detalle ?? 'El servidor no puede validar sesiones ahora mismo. Inténtalo en un momento.'
      );
    default:
      return detalle ?? `El servidor respondió ${status} al subir la grabación.`;
  }
}

/**
 * POST /recordings — sube al backend el audio grabado en el móvil.
 *
 * @param uri URI local (file://) que devuelve el recorder al detenerse.
 * @returns Los datos de la grabación guardada, incluido su `recording_id`.
 * @throws Error con un mensaje ya presentable al usuario si algo falla.
 */
export async function uploadRecording(uri: string): Promise<UploadedRecording> {
  const baseUrl = requireApiUrl();
  const { name, type } = describirArchivo(uri);
  const token = await obtenerToken();

  const formData = new FormData();
  // React Native no tiene File/Blob apuntando al sistema de archivos: su
  // polyfill de FormData acepta este objeto {uri, name, type} y es el módulo
  // nativo quien abre el archivo y arma el cuerpo multipart, así que el audio
  // nunca pasa por la memoria de JS. Los @types de fetch son los del DOM y solo
  // admiten string | Blob; de ahí el cast.
  formData.append('file', { uri, name, type } as unknown as Blob);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/recordings`, {
      method: 'POST',
      // Sin Content-Type a propósito: lo pone fetch con el boundary del
      // multipart. Escribirlo a mano ("multipart/form-data", sin boundary) es
      // el error clásico que deja al backend sin poder parsear el cuerpo.
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `La subida se canceló tras ${UPLOAD_TIMEOUT_MS / 1000}s sin respuesta. ` +
          'Comprueba la conexión y vuelve a intentarlo.'
      );
    }
    const causa = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo conectar con el servidor para subir la grabación (${causa}).`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(mensajeDeError(response.status, await extraerDetalle(response)));
  }

  return (await response.json()) as UploadedRecording;
}
