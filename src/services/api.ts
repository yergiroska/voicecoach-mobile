/**
 * Cliente HTTP del backend FastAPI.
 *
 * La URL base viene de EXPO_PUBLIC_API_URL (ver .env.example). Expo la inlinea
 * en el bundle, por eso hay que referenciarla con dot notation literal:
 * process.env['EXPO_PUBLIC_...'] o desestructurar NO funciona.
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL;

/** Timeout manual: sin esto, un fetch a una IP inalcanzable se cuelga ~1 min. */
const TIMEOUT_MS = 8000;

async function request(path: string): Promise<unknown> {
  if (!API_URL) {
    throw new Error(
      'Falta EXPO_PUBLIC_API_URL. Copia .env.example a .env y recarga la app.'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}${path}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} en ${path}`);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `Timeout tras ${TIMEOUT_MS / 1000}s al llamar a ${API_URL}${path}. ` +
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