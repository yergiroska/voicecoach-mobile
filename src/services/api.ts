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
 * Lo común a una grabación, venga de subirla o de leerla después.
 *
 * El reparto calca el del backend: `filename` existe solo en la respuesta de la
 * subida y `recorded_at` solo en la del detalle, así que ninguno de los dos
 * entra aquí. Lo que se pinte sobre esta base sirve para las dos respuestas sin
 * tener que preguntarse de cuál viene.
 *
 * Se mantienen los nombres en snake_case tal cual llegan por la red: traducir a
 * camelCase obligaría a una capa de mapeo que puede desincronizarse del schema
 * sin que TypeScript se entere.
 */
export type RecordingBase = {
  /** `<uid>_<timestamp>_<aleatorio>`; identifica la grabación en todo el sistema. */
  recording_id: string;
  /** La transcripción. Cadena vacía si el audio no traía voz: eso no es un error. */
  text: string;
  /** Tipo MIME normalizado, sin parámetros. */
  content_type: string | null;
  /** Tamaño real recibido, en bytes. */
  size_bytes: number | null;
  /** Idioma detectado por Whisper. Llega como nombre en inglés ("Spanish"), no como código. */
  language: string | null;
  /** Duración medida por Whisper; puede no cuadrar con la que midió el recorder. */
  duration_seconds: number | null;
  /** Modelo de Groq que produjo la transcripción (Whisper). */
  model: string | null;
  /**
   * Análisis de la comunicación construido sobre `text`.
   *
   * Null cuando el análisis no se pudo hacer. Llega por un camino distinto al de
   * la transcripción y falla por su cuenta: el backend responde 201 con el texto
   * aunque el modelo de análisis no conteste. Dar por hecho este objeto es el
   * error que el propio schema del servidor avisa de no cometer.
   */
  analysis: RecordingAnalysis | null;
};

/** Respuesta de POST /recordings (el `RecordingUploadResponse` del backend). */
export type UploadedRecording = RecordingBase & {
  /**
   * Nombre con el que el backend guardó el archivo mientras lo procesaba.
   *
   * Solo en la subida: no se guarda en la base, y tras una transcripción
   * correcta nombra un archivo que ya no existe.
   */
  filename: string | null;
};

/** Respuesta de GET /recordings/{id} (el `RecordingDetail` del backend). */
export type RecordingDetail = RecordingBase & {
  /**
   * Cuándo se grabó, en ISO 8601 con zona. Solo en el detalle: al subir era
   * "ahora" y no hacía falta.
   *
   * Se queda como string, igual que `recorded_at` en el historial: convertirlo
   * a Date aquí sería la capa de mapeo que este módulo evita.
   */
  recorded_at: string | null;
};

/** Una muletilla detectada y las veces que aparece. */
export type FillerWord = {
  /** La muletilla, ya en minúsculas. */
  word: string;
  count: number;
};

/**
 * Lo que se calcula en Python sobre el texto, sin pasar por el modelo.
 *
 * Son las que hacen que el análisis siga valiendo algo cuando el LLM falla: si
 * los tres scores llegan a null, esto sigue teniendo contenido.
 */
export type SpeechMetrics = {
  word_count: number | null;
  /** Ritmo del habla. Null si Whisper no informó de la duración: no se estima. */
  words_per_minute: number | null;
  filler_count: number | null;
  /** Desglose de más a menos frecuente. Mirar `fillers_analyzed` antes de leerlo. */
  filler_words: FillerWord[];
  /**
   * Si la detección llegó a ejecutarse. Es false cuando el idioma no es
   * español, porque la lista de muletillas es es-ES.
   *
   * CON false, `filler_count: 0` significa "no se miró", NO "no hay ninguna".
   * Enseñar un cero en ese caso sería afirmar algo que nadie ha comprobado.
   */
  fillers_analyzed: boolean;
};

/**
 * Los juicios del modelo, de 0 a 100.
 *
 * Null no es cero: cero es una valoración pésima y null es la ausencia de
 * valoración. Confundirlos se vería en pantalla.
 */
export type CommunicationScores = {
  clarity: number | null;
  confidence: number | null;
  pace: number | null;
};

/** El análisis completo, tal y como lo anida `analysis`. */
export type RecordingAnalysis = {
  metrics: SpeechMetrics;
  scores: CommunicationScores;
  /** Devolución en prosa, en el idioma de la grabación. */
  summary: string | null;
  suggestions: string[];
  /** Modelo que hizo la valoración. OJO: no es el `model` de arriba, que es el de Whisper. */
  model: string | null;
  /** Versión del prompt, para distinguir dos análisis del mismo audio. */
  prompt_version: string | null;
};

/**
 * GET /me/baseline: la línea base del usuario y cómo evolucionan sus sesiones
 * recientes frente a ella. Nombres en snake_case, como el resto del módulo.
 *
 * Las dos familias de datos se exponen DISTINTO a propósito, y el cliente tiene
 * que respetarlo: las métricas deterministas llevan cifras porque son
 * aritmética exacta sobre el texto, y los scores del modelo solo una tendencia
 * en palabras porque tienen un ruido medido de unos ±5 puntos entre pasadas.
 * Enseñar "has pasado de 65 a 60" sería reportarle ruido al usuario como si
 * fuera progreso suyo.
 */
export type BaselineStatus = 'collecting' | 'ready';

/** Tasa de muletillas. Menos es mejor, así que aquí sí hay una buena dirección. */
export type FillerTrend = 'improving' | 'stable' | 'worsening' | 'insufficient_data';

/**
 * Ritmo medido. NO tiene "mejor" ni "peor", y no es un descuido.
 *
 * Acelerar no es progresar: el ritmo tiene un rango adecuado y se puede uno
 * salir por arriba o por abajo. Si esto dijera "improving" al subir, la interfaz
 * acabaría animando a atropellarse.
 */
export type PaceTrend = 'faster' | 'stable' | 'slower' | 'insufficient_data';

/**
 * Tendencia de un score del modelo.
 *
 * Cinco tramos y no tres: con la zona muerta ancha que obliga a dejar el ruido
 * del modelo, distinguir "better" de "much_better" es lo que permite separar una
 * mejora dudosa de una evidente sin enseñar ningún número.
 */
export type ScoreTrend =
  | 'much_better'
  | 'better'
  | 'similar'
  | 'worse'
  | 'much_worse'
  | 'insufficient_data';

/**
 * Cuántas sesiones aportaron un valor a cada ventana.
 *
 * Vienen siempre porque una media no significa nada sin su tamaño de muestra, y
 * porque cada métrica puede tener el suyo: una sesión sin duración de audio no
 * tiene palabras por minuto pero sí muletillas.
 */
export type WindowSamples = {
  baseline_samples: number | null;
  recent_samples: number | null;
};

export type NumericComparison = WindowSamples & {
  /** Media de la línea base: las primeras sesiones válidas. */
  baseline: number | null;
  /** Media de las sesiones recientes, siempre posteriores a la línea base. */
  recent: number | null;
  /** `recent - baseline`. El signo solo no dice si es bueno o malo: para eso está `trend`. */
  delta: number | null;
};

export type FillerRateComparison = NumericComparison & { trend: FillerTrend };

export type WordsPerMinuteComparison = NumericComparison & { trend: PaceTrend };

export type DeterministicMetrics = {
  /** Muletillas por cada 100 palabras: una tasa, no un conteo, para que las sesiones largas no salgan peor por serlo. */
  filler_rate: FillerRateComparison;
  words_per_minute: WordsPerMinuteComparison;
};

/** Tendencia de un score, sin cifras. Ver el comentario de BaselineStatus. */
export type ScoreComparison = WindowSamples & { trend: ScoreTrend };

/**
 * Los scores del modelo, con su PROPIA ventana y su propio estado.
 *
 * Solo cuentan los análisis hechos con el prompt y el modelo actuales, porque
 * dos scores de versiones distintas no son comparables. La consecuencia es que
 * al cambiar cualquiera de los dos esta sección vuelve a `collecting` mientras
 * las métricas siguen listas: la pantalla tiene que poder enseñar las dos cosas
 * a la vez.
 */
export type ScoresBaseline = {
  status: BaselineStatus;
  prompt_version: string | null;
  analysis_model: string | null;
  valid_sessions: number | null;
  sessions_needed: number | null;
  clarity: ScoreComparison | null;
  confidence: ScoreComparison | null;
  /** Adecuación del ritmo SEGÚN EL MODELO. No confundir con `metrics.words_per_minute`, que es la medida objetiva. */
  pace: ScoreComparison | null;
};

export type Baseline = {
  /** Gobierna `metrics`. Los scores tienen el suyo en `scores.status`. */
  status: BaselineStatus;
  /** Sesiones válidas que forman la línea base: las primeras N. */
  baseline_size: number | null;
  recent_window: number | null;
  valid_sessions: number | null;
  /** Sesiones que NO cuentan: silencio, muy cortas, u otro idioma. Sirve para explicar por qué una grabación no hizo avanzar el progreso. */
  excluded_sessions: number | null;
  sessions_needed: number | null;
  /** Null mientras `status` sea `collecting`. */
  metrics: DeterministicMetrics | null;
  scores: ScoresBaseline;
};

/**
 * GET /me/history: el histórico sesión a sesión, que es lo que dibujan las
 * gráficas. Un punto por grabación, de la más antigua a la más nueva — ya vienen
 * en orden de dibujo, así que aquí no se ordena nada.
 *
 * Solo métricas DETERMINISTAS. Los scores del modelo no están y no es un olvido:
 * dibujados sesión a sesión, su ruido de unos ±5 puntos entre pasadas se leería
 * como una tendencia real. Su evolución va agregada y en palabras, en
 * /me/baseline.
 */
export type ExcludedReason = 'not_analyzed' | 'too_short' | 'other_language';

export type HistorySession = {
  recording_id: string;
  /**
   * Cuándo se grabó, en ISO 8601 con zona. Es el eje X.
   *
   * Se queda como string: convertirlo a Date aquí sería justo la capa de mapeo
   * que este módulo evita, y quien decide cómo se lee una fecha es la pantalla.
   */
  recorded_at: string;
  /** Si la sesión cuenta para las gráficas y para la línea base. */
  valid: boolean;
  /** Por qué no cuenta. Null si y solo si `valid` es true. */
  excluded_reason: ExcludedReason | null;
  /** Muletillas por cada 100 palabras. Null en las inválidas. */
  filler_rate: number | null;
  /**
   * Ritmo del habla. Null en las inválidas Y TAMBIÉN en una sesión válida cuyo
   * audio no trajo duración: esa sigue contando para las muletillas y solo le
   * falta este punto.
   *
   * De ahí que las dos gráficas tengan huecos en sitios distintos, que es la
   * razón de fondo por la que no pueden compartir lienzo.
   */
  words_per_minute: number | null;
  /**
   * Palabras de la transcripción. Ayuda a leer `filler_rate`: un 20 % sobre 15
   * palabras pesa menos que sobre 120. Viene también en las inválidas ("1
   * palabra" explica un too_short) y es null solo en `not_analyzed`, donde no
   * hay análisis del que sacarla.
   */
  word_count: number | null;
  /**
   * Si es una de las primeras sesiones válidas que forman la línea base.
   *
   * Son las de TODA la historia, no solo las de esta página: con pocas sesiones
   * por página es normal que no venga ninguna marcada.
   */
  in_baseline: boolean;
};

export type History = {
  /** Todas las grabaciones del usuario, válidas o no, en toda su historia. */
  total_sessions: number | null;
  /** Las que cuentan, también en toda la historia y no solo en esta página. */
  valid_sessions: number | null;
  baseline_size: number | null;
  /** El máximo pedido, que el backend devuelve de vuelta. */
  limit: number | null;
  /** Si hay sesiones más antiguas que no caben en esta página. */
  has_more: boolean;
  /** Vacía si el usuario todavía no ha grabado nada. */
  sessions: HistorySession[];
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

/**
 * Traduce el status a algo que se pueda enseñar tal cual en la pantalla.
 *
 * `accion` solo entra en el caso por defecto, que es el único mensaje que nombra
 * la operación. Con el valor por defecto, quien ya llamaba a esta función sigue
 * obteniendo exactamente el mismo texto.
 */
function mensajeDeError(
  status: number,
  detalle: string | null,
  accion = 'al subir la grabación'
): string {
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
      return detalle ?? `El servidor respondió ${status} ${accion}.`;
  }
}

/**
 * GET autenticado contra el backend.
 *
 * Reúne las cuatro cosas que hasta ahora solo existían dentro de
 * uploadRecording: el token de Firebase, el timeout manual, la extracción del
 * `detail` de FastAPI y su traducción a un mensaje enseñable. Sin esto, cada
 * endpoint nuevo volvería a copiarlas.
 *
 * No sustituye a request(): ese sirve a /health, que es público y cuyo error
 * crudo no llega a ninguna pantalla.
 *
 * Devuelve `unknown` a propósito. Validar el cuerpo es de quien sabe qué forma
 * espera, no de la capa de transporte.
 */
async function requestAutenticado(path: string): Promise<unknown> {
  const baseUrl = requireApiUrl();
  const token = await obtenerToken();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `Timeout tras ${TIMEOUT_MS / 1000}s al llamar a ${baseUrl}${path}. ` +
          '¿El backend sigue corriendo y el móvil está en la misma red?'
      );
    }
    const causa = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo conectar con el servidor (${causa}).`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(
      mensajeDeError(response.status, await extraerDetalle(response), 'al consultar el servidor')
    );
  }

  return await response.json();
}

/** Mensaje para una respuesta de POST /recordings que no encaje con el schema. */
const ERROR_RESPUESTA =
  'El servidor respondió algo que la app no entiende. Vuelve a enviar la grabación.';

/** Lo mismo para el detalle, donde "vuelve a enviarla" no tendría sentido. */
const ERROR_DETALLE =
  'El servidor respondió algo que la app no entiende al pedir la grabación.';

/** Devuelve el campo si es un string, o null si falta o es de otro tipo. */
function leerTexto(datos: Record<string, unknown>, campo: string): string | null {
  const valor = datos[campo];
  return typeof valor === 'string' ? valor : null;
}

/**
 * Un valor de una lista cerrada, o `porDefecto` si no es ninguno de ellos.
 *
 * El default no es un detalle: si el backend añade mañana una tendencia que esta
 * versión del cliente no conoce, caer en "insufficient_data" dice "todavía no se
 * sabe", que desde aquí es literalmente cierto. Adivinar "stable" sería afirmar
 * que no ha cambiado nada, que es una afirmación que nadie ha medido.
 */
function leerOpcion<T extends string>(
  datos: Record<string, unknown>,
  campo: string,
  permitidas: readonly T[],
  porDefecto: T
): T {
  const valor = datos[campo];
  return typeof valor === 'string' && (permitidas as readonly string[]).includes(valor)
    ? (valor as T)
    : porDefecto;
}

/** Igual que leerTexto pero para números; descarta NaN e Infinity. */
function leerNumero(datos: Record<string, unknown>, campo: string): number | null {
  const valor = datos[campo];
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

/** El campo si es un objeto (no un array ni null); si no, null. */
function leerObjeto(datos: Record<string, unknown>, campo: string): Record<string, unknown> | null {
  const valor = datos[campo];
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

/** El campo si es un booleano; si no, null (para poder distinguir "ausente"). */
function leerBooleano(datos: Record<string, unknown>, campo: string): boolean | null {
  const valor = datos[campo];
  return typeof valor === 'boolean' ? valor : null;
}

/**
 * Los strings de una lista, descartando lo que no lo sea.
 *
 * Devuelve [] y no null: para una lista, "vacía" y "ausente" se pintan igual, y
 * así la pantalla itera sin comprobar nada antes.
 */
function leerListaDeTextos(datos: Record<string, unknown>, campo: string): string[] {
  const valor = datos[campo];
  return Array.isArray(valor) ? valor.filter((item): item is string => typeof item === 'string') : [];
}

/** Las muletillas bien formadas de la lista; una entrada rota no tira las demás. */
function leerMuletillas(datos: Record<string, unknown>, campo: string): FillerWord[] {
  const valor = datos[campo];
  if (!Array.isArray(valor)) {
    return [];
  }

  const muletillas: FillerWord[] = [];
  for (const item of valor) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const entrada = item as Record<string, unknown>;
    const word = leerTexto(entrada, 'word');
    const count = leerNumero(entrada, 'count');
    if (word !== null && count !== null) {
      muletillas.push({ word, count });
    }
  }

  return muletillas;
}

/** Las métricas deterministas. Recibe null si `metrics` no venía. */
function validarMetricas(datos: Record<string, unknown> | null): SpeechMetrics {
  const campos = datos ?? {};

  return {
    word_count: leerNumero(campos, 'word_count'),
    words_per_minute: leerNumero(campos, 'words_per_minute'),
    filler_count: leerNumero(campos, 'filler_count'),
    filler_words: leerMuletillas(campos, 'filler_words'),
    // Ausente cuenta como false, que es el default seguro: si no consta que las
    // muletillas se analizaran, la pantalla no debe enseñar ningún conteo.
    // Equivocarse hacia true produciría el "0 muletillas, ¡perfecto!" sobre un
    // audio que nadie miró.
    fillers_analyzed: leerBooleano(campos, 'fillers_analyzed') ?? false,
  };
}

/** Los tres scores. Recibe null si `scores` no venía. */
function validarScores(datos: Record<string, unknown> | null): CommunicationScores {
  const campos = datos ?? {};

  return {
    clarity: leerNumero(campos, 'clarity'),
    confidence: leerNumero(campos, 'confidence'),
    pace: leerNumero(campos, 'pace'),
  };
}

/**
 * El análisis, o null si no vino uno aprovechable. NO lanza nunca.
 *
 * Esa es la diferencia con validarRespuesta: un análisis roto no puede tumbar
 * una subida cuya transcripción llegó bien, que es lo caro de recuperar. Se
 * degrada a null y la pantalla lo dice sin alarmar.
 *
 * `metrics` y `scores` se devuelven siempre como objeto, aunque no vinieran, para
 * que quien los consuma mire un solo nivel de nulidad (cada campo) en vez de dos.
 */
function validarAnalisis(valor: unknown): RecordingAnalysis | null {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    return null;
  }

  const datos = valor as Record<string, unknown>;

  return {
    metrics: validarMetricas(leerObjeto(datos, 'metrics')),
    scores: validarScores(leerObjeto(datos, 'scores')),
    summary: leerTexto(datos, 'summary'),
    suggestions: leerListaDeTextos(datos, 'suggestions'),
    model: leerTexto(datos, 'model'),
    prompt_version: leerTexto(datos, 'prompt_version'),
  };
}

/**
 * Comprueba el cuerpo de POST /recordings en vez de castearlo con `as`.
 *
 * Mientras la respuesta eran cuatro metadatos, el cast salía gratis: un campo
 * ausente se habría visto como un `undefined` feo en una línea secundaria. Con
 * la transcripción ya no, porque `text` es lo único que la pantalla de resultado
 * enseña, y si llegara ausente el usuario vería una pantalla en blanco sin nada
 * que le explique qué pasó.
 *
 * De ahí el reparto: se exige lo que sostiene el flujo (`recording_id` y `text`)
 * y se acepta que falte todo lo demás. El resto son datos de apoyo que la interfaz
 * puede omitir, así que exigirlos convertiría un cambio menor del backend en una
 * subida rechazada teniendo la transcripción ya en la mano.
 */
function comoObjeto(body: unknown, mensaje: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error(mensaje);
  }
  return body as Record<string, unknown>;
}

/**
 * Los campos que comparten la subida y el detalle.
 *
 * El mensaje de fallo entra por parámetro porque lo que el usuario puede hacer
 * no es lo mismo en los dos casos: tras subir tiene sentido pedirle que lo
 * reintente, y al abrir una grabación guardada no.
 */
function validarCamposComunes(datos: Record<string, unknown>, mensaje: string): RecordingBase {
  const recording_id = leerTexto(datos, 'recording_id');
  const text = leerTexto(datos, 'text');

  // Se comprueba que `text` VENGA y sea string, no que tenga contenido: un audio
  // en silencio devuelve "" legítimamente y la pantalla lo resuelve con un estado
  // vacío. Rechazarlo aquí sería tratar una grabación válida como un fallo.
  if (recording_id === null || text === null) {
    throw new Error(mensaje);
  }

  return {
    recording_id,
    text,
    content_type: leerTexto(datos, 'content_type'),
    size_bytes: leerNumero(datos, 'size_bytes'),
    language: leerTexto(datos, 'language'),
    duration_seconds: leerNumero(datos, 'duration_seconds'),
    model: leerTexto(datos, 'model'),
    analysis: validarAnalisis(datos.analysis),
  };
}

function validarRespuesta(body: unknown): UploadedRecording {
  const datos = comoObjeto(body, ERROR_RESPUESTA);

  return {
    ...validarCamposComunes(datos, ERROR_RESPUESTA),
    filename: leerTexto(datos, 'filename'),
  };
}

function validarDetalle(body: unknown): RecordingDetail {
  const datos = comoObjeto(body, ERROR_DETALLE);

  return {
    ...validarCamposComunes(datos, ERROR_DETALLE),
    recorded_at: leerTexto(datos, 'recorded_at'),
  };
}

/**
 * POST /recordings — sube al backend el audio grabado en el móvil.
 *
 * @param uri URI local (file://) que devuelve el recorder al detenerse.
 * @returns La grabación guardada con su transcripción ya resuelta por el backend.
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

  return validarRespuesta(await response.json());
}
/** Mensaje para una respuesta de /me/baseline que no se puede interpretar. */
const ERROR_BASELINE =
  'El servidor respondió algo que la app no entiende al pedir tu progreso.';

const ESTADOS: readonly BaselineStatus[] = ['collecting', 'ready'];

const TENDENCIAS_MULETILLAS: readonly FillerTrend[] = [
  'improving',
  'stable',
  'worsening',
  'insufficient_data',
];

const TENDENCIAS_RITMO: readonly PaceTrend[] = [
  'faster',
  'stable',
  'slower',
  'insufficient_data',
];

const TENDENCIAS_SCORE: readonly ScoreTrend[] = [
  'much_better',
  'better',
  'similar',
  'worse',
  'much_worse',
  'insufficient_data',
];

/** Una comparación con cifras. Recibe null si el objeto no venía. */
function validarComparacion<T extends string>(
  datos: Record<string, unknown> | null,
  permitidas: readonly T[],
  porDefecto: T
): NumericComparison & { trend: T } {
  const campos = datos ?? {};

  return {
    baseline: leerNumero(campos, 'baseline'),
    recent: leerNumero(campos, 'recent'),
    delta: leerNumero(campos, 'delta'),
    baseline_samples: leerNumero(campos, 'baseline_samples'),
    recent_samples: leerNumero(campos, 'recent_samples'),
    trend: leerOpcion(campos, 'trend', permitidas, porDefecto),
  };
}

/** Null cuando `metrics` no vino, que es lo normal en `collecting`. */
function validarMetricasBaseline(
  datos: Record<string, unknown> | null
): DeterministicMetrics | null {
  if (datos === null) {
    return null;
  }

  return {
    filler_rate: validarComparacion(
      leerObjeto(datos, 'filler_rate'),
      TENDENCIAS_MULETILLAS,
      'insufficient_data'
    ),
    words_per_minute: validarComparacion(
      leerObjeto(datos, 'words_per_minute'),
      TENDENCIAS_RITMO,
      'insufficient_data'
    ),
  };
}

/** Null cuando el score no vino, que es lo normal mientras `scores.status` es `collecting`. */
function validarScoreComparison(
  datos: Record<string, unknown> | null
): ScoreComparison | null {
  if (datos === null) {
    return null;
  }

  return {
    trend: leerOpcion(datos, 'trend', TENDENCIAS_SCORE, 'insufficient_data'),
    baseline_samples: leerNumero(datos, 'baseline_samples'),
    recent_samples: leerNumero(datos, 'recent_samples'),
  };
}

/**
 * La sección de scores, siempre como objeto.
 *
 * Aunque no viniera se devuelve una con `status: 'collecting'`, para que la
 * pantalla mire un solo nivel de nulidad en vez de dos.
 */
function validarScoresBaseline(datos: Record<string, unknown> | null): ScoresBaseline {
  const campos = datos ?? {};

  return {
    status: leerOpcion(campos, 'status', ESTADOS, 'collecting'),
    prompt_version: leerTexto(campos, 'prompt_version'),
    analysis_model: leerTexto(campos, 'analysis_model'),
    valid_sessions: leerNumero(campos, 'valid_sessions'),
    sessions_needed: leerNumero(campos, 'sessions_needed'),
    clarity: validarScoreComparison(leerObjeto(campos, 'clarity')),
    confidence: validarScoreComparison(leerObjeto(campos, 'confidence')),
    pace: validarScoreComparison(leerObjeto(campos, 'pace')),
  };
}

/**
 * Comprueba el cuerpo de GET /me/baseline.
 *
 * Al contrario que validarAnalisis, este SÍ lanza cuando el cuerpo no es un
 * objeto, y la diferencia es de fondo: el análisis viaja de acompañante de una
 * transcripción que vale por sí sola, mientras que aquí el baseline es toda la
 * carga útil. Si no se entiende, no queda nada que enseñar, y decirlo es mejor
 * que pintar una pantalla de progreso vacía.
 *
 * A partir de ahí degrada: `status` desconocido cae en `collecting`, que es el
 * conservador, porque con `collecting` no se enseña ninguna comparación. Preferir
 * eso a mostrar cifras de las que no sabemos si son válidas.
 */
function validarBaseline(body: unknown): Baseline {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error(ERROR_BASELINE);
  }

  const datos = body as Record<string, unknown>;

  return {
    status: leerOpcion(datos, 'status', ESTADOS, 'collecting'),
    baseline_size: leerNumero(datos, 'baseline_size'),
    recent_window: leerNumero(datos, 'recent_window'),
    valid_sessions: leerNumero(datos, 'valid_sessions'),
    excluded_sessions: leerNumero(datos, 'excluded_sessions'),
    sessions_needed: leerNumero(datos, 'sessions_needed'),
    metrics: validarMetricasBaseline(leerObjeto(datos, 'metrics')),
    scores: validarScoresBaseline(leerObjeto(datos, 'scores')),
  };
}

/**
 * GET /me/baseline — la línea base del usuario y su evolución reciente.
 *
 * @throws Error con un mensaje ya presentable al usuario si algo falla.
 */
export async function getBaseline(): Promise<Baseline> {
  return validarBaseline(await requestAutenticado('/me/baseline'));
}
/** Mensaje para una respuesta de /me/history que no se puede interpretar. */
const ERROR_HISTORIAL =
  'El servidor respondió algo que la app no entiende al pedir tu historial.';

const MOTIVOS_EXCLUSION: readonly ExcludedReason[] = [
  'not_analyzed',
  'too_short',
  'other_language',
];

/** El motivo si es uno de los conocidos; null si no vino o no lo reconocemos. */
function leerMotivoExclusion(datos: Record<string, unknown>): ExcludedReason | null {
  const valor = datos.excluded_reason;
  return typeof valor === 'string' &&
    (MOTIVOS_EXCLUSION as readonly string[]).includes(valor)
    ? (valor as ExcludedReason)
    : null;
}

/**
 * Una sesión, o null si le falta lo mínimo para ser un punto de la gráfica.
 *
 * Se exigen `recording_id` y `recorded_at` porque sin identidad ni fecha no hay
 * nada que situar en el eje. Todo lo demás degrada: una sesión sin métricas no
 * es un error, es un hueco legítimo en la línea.
 */
function validarSesion(valor: unknown): HistorySession | null {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    return null;
  }

  const datos = valor as Record<string, unknown>;

  const recording_id = leerTexto(datos, 'recording_id');
  const recorded_at = leerTexto(datos, 'recorded_at');

  if (recording_id === null || recorded_at === null) {
    return null;
  }

  const excluded_reason = leerMotivoExclusion(datos);

  return {
    recording_id,
    recorded_at,
    // Si `valid` no viene no se adivina con un default plano: se deriva del
    // invariante que el propio backend declara y verifica ("excluded_reason es
    // null si y solo si la sesión es válida"). Un default fijo fallaría en las
    // dos direcciones — true escondería exclusiones reales y false inventaría
    // sesiones fallidas que no existen.
    valid: leerBooleano(datos, 'valid') ?? excluded_reason === null,
    excluded_reason,
    filler_rate: leerNumero(datos, 'filler_rate'),
    words_per_minute: leerNumero(datos, 'words_per_minute'),
    word_count: leerNumero(datos, 'word_count'),
    // Ausente cuenta como false: no marcar ninguna sesión como línea base es
    // preferible a sombrear un tramo que quizá no lo sea.
    in_baseline: leerBooleano(datos, 'in_baseline') ?? false,
  };
}

/**
 * Comprueba el cuerpo de GET /me/history.
 *
 * Lanza si no es un objeto, igual que validarBaseline y por el mismo motivo: el
 * historial es toda la carga útil de esta petición, así que si no se entiende no
 * queda nada que dibujar.
 *
 * A partir de ahí degrada, y una sesión malformada se descarta sola sin tirar
 * las demás: es la misma regla que sigue leerMuletillas. Perder un punto de
 * treinta es mucho mejor que perder la gráfica entera.
 */
function validarHistorial(body: unknown): History {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error(ERROR_HISTORIAL);
  }

  const datos = body as Record<string, unknown>;
  const crudas = Array.isArray(datos.sessions) ? datos.sessions : [];

  const sessions: HistorySession[] = [];
  for (const cruda of crudas) {
    const sesion = validarSesion(cruda);
    if (sesion !== null) {
      sessions.push(sesion);
    }
  }

  return {
    total_sessions: leerNumero(datos, 'total_sessions'),
    valid_sessions: leerNumero(datos, 'valid_sessions'),
    baseline_size: leerNumero(datos, 'baseline_size'),
    limit: leerNumero(datos, 'limit'),
    // Ausente cuenta como false: no dar a entender que hay más sesiones de las
    // que se están enseñando.
    has_more: leerBooleano(datos, 'has_more') ?? false,
    sessions,
  };
}

/** Sesiones que se piden por defecto. El backend admite hasta 100. */
const SESIONES_POR_DEFECTO = 30;

/**
 * GET /me/history — las sesiones más recientes, una por punto de gráfica.
 *
 * @throws Error con un mensaje ya presentable al usuario si algo falla.
 */
export async function getHistory(limit: number = SESIONES_POR_DEFECTO): Promise<History> {
  return validarHistorial(await requestAutenticado(`/me/history?limit=${limit}`));
}
/**
 * GET /recordings/{id} — una grabación ya guardada, con su transcripción y su
 * análisis.
 *
 * Un 404 llega con el `detail` del backend ("Grabación no encontrada.") y no
 * recibe trato especial: desde la app no hay forma de pedir un id inexistente,
 * porque la lista sale de /me/history, que solo contiene grabaciones guardadas,
 * y el flujo de subida pinta el objeto que ya tiene en lugar de volver a pedirlo.
 *
 * @throws Error con un mensaje ya presentable al usuario si algo falla.
 */
export async function getRecording(recordingId: string): Promise<RecordingDetail> {
  return validarDetalle(
    await requestAutenticado(`/recordings/${encodeURIComponent(recordingId)}`)
  );
}
