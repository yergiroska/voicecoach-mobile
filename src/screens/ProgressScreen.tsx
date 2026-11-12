/**
 * Evolución del usuario: sus sesiones recientes frente a su línea base.
 *
 * Primera pantalla del proyecto que pide datos al montarse. Las demás reaccionan
 * a algo que el usuario hizo (enviar el formulario, subir la grabación), así que
 * el estado de carga vivía dentro de un botón; aquí no hay botón que esperar y
 * la pantalla arranca vacía.
 *
 * Los dos bloques —métricas y valoración— se pintan por SEPARADO y cada uno mira
 * su propio `status`. No es un capricho de maquetación: la valoración solo
 * compara análisis hechos con el prompt y el modelo actuales, así que al cambiar
 * cualquiera de los dos vuelve a reunir datos mientras las métricas, que son
 * aritmética sobre el texto, siguen listas. Un estado único tendría que esperar
 * al más lento y esconder datos que ya son válidos.
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import ComparisonRow, { type Tono } from '../components/ComparisonRow';
import MetricChart, { type PuntoGrafica } from '../components/MetricChart';
import {
  getBaseline,
  getHistory,
  type Baseline,
  type ExcludedReason,
  type FillerTrend,
  type History,
  type HistorySession,
  type NumericComparison,
  type PaceTrend,
  type ScoreTrend,
  type WindowSamples,
} from '../services/api';
import type { AppStackScreenProps } from '../navigation/types';

type Tendencia = { texto: string; tono: Tono };

/**
 * Las tendencias del backend, traducidas.
 *
 * Con `Record` sobre la unión, añadir un valor al tipo en api.ts deja de
 * compilar aquí hasta que se le da texto: no se puede olvidar ninguno.
 */
const TENDENCIA_MULETILLAS: Record<FillerTrend, Tendencia> = {
  improving: { texto: 'Mejorando', tono: 'positivo' },
  stable: { texto: 'Estable', tono: 'neutro' },
  worsening: { texto: 'Empeorando', tono: 'atencion' },
  insufficient_data: { texto: 'Aún no se sabe', tono: 'sin-dato' },
};

/**
 * El ritmo va TODO en neutro, incluidos "más rápido" y "más lento".
 *
 * No es que falte matiz: acelerar no es mejorar ni empeorar. El rango adecuado
 * se sale por los dos lados, y darle color a una de las dos direcciones sería
 * empujar al usuario hacia ella.
 */
const TENDENCIA_RITMO: Record<PaceTrend, Tendencia> = {
  faster: { texto: 'Más rápido', tono: 'neutro' },
  stable: { texto: 'Estable', tono: 'neutro' },
  slower: { texto: 'Más lento', tono: 'neutro' },
  insufficient_data: { texto: 'Aún no se sabe', tono: 'sin-dato' },
};

const TENDENCIA_SCORE: Record<ScoreTrend, Tendencia> = {
  much_better: { texto: 'Mucho mejor', tono: 'positivo' },
  better: { texto: 'Mejor', tono: 'positivo' },
  similar: { texto: 'Similar', tono: 'neutro' },
  worse: { texto: 'Peor', tono: 'atencion' },
  much_worse: { texto: 'Mucho peor', tono: 'atencion' },
  insufficient_data: { texto: 'Aún no se sabe', tono: 'sin-dato' },
};

/**
 * Afina el "aún no se sabe" cuando la causa es que no hay nada nuevo que medir.
 *
 * Es el caso que ve TODO el mundo justo al alcanzar la línea base: ya hay cinco
 * sesiones, pero ninguna posterior con la que compararlas. Decir "aún no se
 * sabe" ahí suena a que algo falló; decir que faltan sesiones nuevas explica qué
 * hacer.
 */
function ajustarPorFaltaDeSesiones(tendencia: Tendencia, muestras: WindowSamples): Tendencia {
  if (tendencia.tono !== 'sin-dato' || muestras.recent_samples !== 0) {
    return tendencia;
  }
  return { texto: 'Sin sesiones nuevas', tono: 'sin-dato' };
}

/** Un decimal y coma decimal: es la precisión que da el backend y la convención de aquí. */
function formatearCifra(valor: number): string {
  return valor.toFixed(1).replace('.', ',');
}

/** El delta siempre con su signo, para que se lea como un cambio y no como un valor. */
function formatearDelta(valor: number): string {
  // Se redondea ANTES de mirar el signo: sin esto, un -0,04 se imprimiría como
  // "−0,0", que es un cambio a peor que en realidad no existe.
  const redondeado = Number(valor.toFixed(1));
  const cifra = formatearCifra(Math.abs(redondeado));

  if (redondeado > 0) {
    return `+${cifra}`;
  }
  if (redondeado < 0) {
    return `−${cifra}`;
  }
  return cifra;
}

/**
 * Las cifras de una comparación, o undefined si falta alguna.
 *
 * Con undefined, ComparisonRow pinta solo la tendencia. Es lo correcto: cuando
 * una ventana no llega al mínimo de muestras no hay media que enseñar, y un
 * "0,0 → 0,0" sería inventarse una comparación que nadie hizo.
 */
function construirCifras(comparacion: NumericComparison, unidad: string) {
  const { baseline, recent, delta } = comparacion;

  if (baseline === null || recent === null || delta === null) {
    return undefined;
  }

  return {
    antes: formatearCifra(baseline),
    despues: formatearCifra(recent),
    unidad,
    delta: formatearDelta(delta),
  };
}

/** "Llevas 3 de 5 sesiones válidas. Faltan 2 para poder comparar." */
function describirRecogida(
  validas: number | null,
  total: number | null,
  faltan: number | null
): string {
  if (validas === null || total === null) {
    return 'Todavía se están reuniendo tus primeras sesiones.';
  }

  const progreso = `Llevas ${validas} de ${total} sesiones válidas.`;

  if (faltan === null || faltan <= 0) {
    return progreso;
  }
  return `${progreso} ${faltan === 1 ? 'Falta 1' : `Faltan ${faltan}`} para poder comparar.`;
}

/**
 * Por qué algunas grabaciones no han hecho avanzar el contador.
 *
 * El backend expone `excluded_sessions` justamente para poder decirlo: sin esto,
 * grabar y ver el progreso parado parecería un fallo de la app.
 */
function describirExcluidas(excluidas: number | null): string | null {
  if (excluidas === null || excluidas <= 0) {
    return null;
  }

  const cuantas =
    excluidas === 1 ? '1 grabación no cuenta' : `${excluidas} grabaciones no cuentan`;
  return `${cuantas}: fueron muy cortas, en silencio o en otro idioma.`;
}

/**
 * La fecha de una sesión, corta, para la etiqueta del eje X.
 *
 * Se compone a mano en vez de con toLocaleDateString porque el soporte de Intl
 * en Hermes no es igual en las dos plataformas, y "14/3" se entiende en todas.
 * Si el string no es una fecha válida se devuelve vacío: una etiqueta ausente
 * estorba menos que un "Invalid Date".
 */
function formatearFecha(iso: string): string {
  const fecha = new Date(iso);

  if (Number.isNaN(fecha.getTime())) {
    return '';
  }
  return `${fecha.getDate()}/${fecha.getMonth() + 1}`;
}

/**
 * Una sola fecha por grupo de sesiones del mismo día, puesta en el punto
 * central del grupo. El resto de posiciones van sin etiqueta.
 *
 * El eje dibuja cada etiqueta bajo SU punto, y la librería descarta los textos
 * repetidos quedándose con el primero. Sin esto, con diez sesiones del mismo día
 * la fecha caía bajo la primera de las diez, y las dos fechas del eje acababan
 * amontonadas a la izquierda sin relación con dónde estaban los puntos.
 *
 * Decidiendo aquí qué punto lleva texto, cada fecha queda centrada bajo su
 * grupo. La cadena vacía no pinta nada: el punto se dibuja igual.
 */
function etiquetarGrupos(sesiones: HistorySession[]): string[] {
  const fechas = sesiones.map((sesion) => formatearFecha(sesion.recorded_at));
  const etiquetas = fechas.map(() => '');

  let inicio = 0;
  for (let i = 1; i <= fechas.length; i += 1) {
    // Cierra el grupo al cambiar de fecha, y también al llegar al final.
    if (i === fechas.length || fechas[i] !== fechas[inicio]) {
      etiquetas[Math.floor((inicio + i - 1) / 2)] = fechas[inicio] ?? '';
      inicio = i;
    }
  }

  return etiquetas;
}

/**
 * Los puntos de una gráfica.
 *
 * No se filtran las sesiones sin dato: entran con `valor: null` para que la
 * gráfica deje el hueco. Quitarlas juntaría dos sesiones no consecutivas y
 * dibujaría una pendiente que nadie midió. Tampoco se ordenan: el backend ya
 * las manda de la más antigua a la más nueva.
 */
function construirPuntos(
  sesiones: HistorySession[],
  metrica: 'filler_rate' | 'words_per_minute'
): PuntoGrafica[] {
  const etiquetas = etiquetarGrupos(sesiones);

  return sesiones.map((sesion, indice) => ({
    // El recording_id y no la fecha: ver el comentario de PuntoGrafica.clave.
    // Dos sesiones del mismo día comparten fecha pero no posición.
    clave: sesion.recording_id,
    etiqueta: etiquetas[indice] ?? '',
    valor: sesion[metrica],
    enLineaBase: sesion.in_baseline,
  }));
}

/** La línea de referencia, solo si la línea base ya está fijada. */
function construirReferencia(
  valor: number | null | undefined
): { valor: number; etiqueta: string } | undefined {
  return valor === null || valor === undefined
    ? undefined
    : { valor, etiqueta: 'Tu línea base' };
}

const NOMBRE_EXCLUSION: Record<ExcludedReason, string> = {
  too_short: 'muy cortas',
  other_language: 'en otro idioma',
  not_analyzed: 'sin analizar',
};

/** Orden fijo para que la frase no cambie de forma entre dos cargas iguales. */
const ORDEN_EXCLUSION: readonly ExcludedReason[] = [
  'too_short',
  'other_language',
  'not_analyzed',
];

/**
 * "3 de 30 sesiones no cuentan: 2 muy cortas · 1 en otro idioma."
 *
 * Aquí se desglosa por motivo, al contrario que en el bloque de la línea base,
 * porque este endpoint sí lo trae sesión a sesión. Y el motivo importa: una
 * grabación muy corta se arregla hablando más, y una en otro idioma no se
 * arregla en absoluto.
 */
function describirExclusionesDelHistorial(sesiones: HistorySession[]): string | null {
  const invalidas = sesiones.filter((sesion) => !sesion.valid);

  if (invalidas.length === 0) {
    return null;
  }

  const conteo: Record<ExcludedReason, number> = {
    too_short: 0,
    other_language: 0,
    not_analyzed: 0,
  };
  let sinMotivo = 0;

  for (const { excluded_reason } of invalidas) {
    if (excluded_reason === null) {
      sinMotivo += 1;
    } else {
      conteo[excluded_reason] += 1;
    }
  }

  const partes = ORDEN_EXCLUSION.filter((motivo) => conteo[motivo] > 0).map(
    (motivo) => `${conteo[motivo]} ${NOMBRE_EXCLUSION[motivo]}`
  );
  if (sinMotivo > 0) {
    partes.push(`${sinMotivo} sin motivo conocido`);
  }

  const cabecera = `${invalidas.length} de ${sesiones.length} sesiones no cuentan`;
  return partes.length > 0 ? `${cabecera}: ${partes.join(' · ')}.` : `${cabecera}.`;
}

/** "Mostrando las últimas 30 de 47 sesiones." Null si no hay más que enseñar. */
function describirAlcance(historial: History): string | null {
  if (!historial.has_more || historial.total_sessions === null) {
    return null;
  }
  return `Mostrando las últimas ${historial.sessions.length} de ${historial.total_sessions} sesiones.`;
}

type EstadoCarga =
  | { estado: 'cargando' }
  | { estado: 'ok'; baseline: Baseline }
  | { estado: 'error'; mensaje: string };

/**
 * Pide el baseline y envuelve el fallo en el estado, sin lanzar.
 *
 * Fuera del componente porque no toca estado de React: así la usan igual la
 * carga inicial y el botón de actualizar, sin duplicar el try/catch.
 */
async function pedirBaseline(): Promise<EstadoCarga> {
  try {
    return { estado: 'ok', baseline: await getBaseline() };
  } catch (error) {
    // getBaseline ya lanza Error con mensajes pensados para enseñarse tal cual;
    // el fallback solo cubre que lo lanzado no sea un Error.
    return {
      estado: 'error',
      mensaje: error instanceof Error ? error.message : 'No se pudo cargar tu progreso.',
    };
  }
}

type EstadoHistorial =
  | { estado: 'cargando' }
  | { estado: 'ok'; historial: History }
  | { estado: 'error'; mensaje: string };

/** Igual que pedirBaseline: envuelve el fallo en el estado y no lanza. */
async function pedirHistorial(): Promise<EstadoHistorial> {
  try {
    return { estado: 'ok', historial: await getHistory() };
  } catch (error) {
    return {
      estado: 'error',
      mensaje: error instanceof Error ? error.message : 'No se pudo cargar tu historial.',
    };
  }
}

/**
 * Lo que queda en un bloque tras pulsar "Actualizar".
 *
 * Si el bloque ya tenía contenido y la petición nueva falla, se conserva lo que
 * había: sigue siendo válido, y cambiarlo por un mensaje de error por un fallo
 * de red es peor que no haber refrescado. Es el mismo criterio que el
 * pull-to-refresh de la lista de grabaciones. En cualquier otro caso manda el
 * resultado nuevo, así que desde un error "Actualizar" sigue sirviendo de
 * reintento.
 */
function fusionarRefresco<T extends { estado: string }>(anterior: T, nuevo: T): T {
  return anterior.estado === 'ok' && nuevo.estado === 'error' ? anterior : nuevo;
}

export default function ProgressScreen({ navigation }: AppStackScreenProps<'Progress'>) {
  const [carga, setCarga] = useState<EstadoCarga>({ estado: 'cargando' });
  // Separado del estado: al actualizar, la pantalla NO vuelve a 'cargando'. Si
  // lo hiciera, el contenido desaparecería y volvería a aparecer, que es peor
  // que verlo quieto un segundo mientras el spinner gira en el botón.
  const [refrescando, setRefrescando] = useState(false);
  // Su propio estado, no uno compartido: si el historial falla, las
  // comparaciones de arriba siguen en pantalla.
  const [historial, setHistorial] = useState<EstadoHistorial>({ estado: 'cargando' });
  // Algún bloque conservó su contenido porque el último "Actualizar" falló. No se
  // borra al empezar a refrescar, sino cuando un refresco termina sin conservar
  // nada: así el aviso no parpadea mientras gira el botón.
  const [falloRefresco, setFalloRefresco] = useState(false);

  // La petición sigue viva aunque el usuario se vaya de la pantalla; sin esta
  // comprobación, al volver escribiríamos sobre un componente desmontado.
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;

    // En paralelo y cada una a lo suyo: no se espera a la más lenta ni una
    // arrastra a la otra si falla.
    void pedirBaseline().then((resultado) => {
      if (montado.current) {
        setCarga(resultado);
      }
    });

    void pedirHistorial().then((resultado) => {
      if (montado.current) {
        setHistorial(resultado);
      }
    });

    return () => {
      montado.current = false;
    };
  }, []);

  async function actualizar() {
    setRefrescando(true);
    // Promise.all sin riesgo: ninguna de las dos rechaza, devuelven el fallo
    // dentro del estado. Se espera a las dos para que el botón no deje de girar
    // con una todavía en vuelo.
    const [resultadoBaseline, resultadoHistorial] = await Promise.all([
      pedirBaseline(),
      pedirHistorial(),
    ]);

    if (!montado.current) {
      return;
    }

    // Cada bloque decide por su cuenta. El estado se fusiona con el valor más
    // reciente (forma funcional), y el aviso se calcula con el que había al
    // pulsar. Solo difieren si la carga inicial de un bloque termina mientras se
    // refresca, y ahí lo peor que pasa es que el aviso no salga.
    const conservaBaseline = carga.estado === 'ok' && resultadoBaseline.estado === 'error';
    const conservaHistorial = historial.estado === 'ok' && resultadoHistorial.estado === 'error';

    setCarga((anterior) => fusionarRefresco(anterior, resultadoBaseline));
    setHistorial((anterior) => fusionarRefresco(anterior, resultadoHistorial));
    setFalloRefresco(conservaBaseline || conservaHistorial);
    setRefrescando(false);
  }

  // El spinner a pantalla completa solo mientras NO hay nada que enseñar. En
  // cuanto una de las dos peticiones vuelve se monta la pantalla, y la que siga
  // en vuelo enseña su propio estado dentro de su bloque. Que una falle no
  // puede esconder a la otra: son datos distintos de endpoints distintos.
  if (carga.estado === 'cargando' && historial.estado === 'cargando') {
    return (
      <View style={styles.centrado}>
        <ActivityIndicator />
        <Text style={styles.emptyText}>Cargando…</Text>
      </View>
    );
  }

  // Null mientras el baseline no haya llegado o haya fallado. Ya no hay return
  // temprano por él: el botón "Actualizar" del final hace de reintento.
  const baseline = carga.estado === 'ok' ? carga.baseline : null;

  const metricasListas =
    baseline !== null && baseline.status === 'ready' && baseline.metrics !== null;
  const excluidas = describirExcluidas(baseline?.excluded_sessions ?? null);

  // Las referencias salen de la OTRA petición. Los dos estados siguen
  // independientes: si el baseline no está listo, la gráfica se dibuja sin
  // línea y ya, en vez de esperarlo.
  const metricasBaseline = baseline !== null && metricasListas ? baseline.metrics : null;
  const referenciaMuletillas = construirReferencia(metricasBaseline?.filler_rate.baseline);
  const referenciaRitmo = construirReferencia(metricasBaseline?.words_per_minute.baseline);

  const sesiones = historial.estado === 'ok' ? historial.historial.sessions : [];
  // La sección se oculta entera solo cuando sabemos que no hay ninguna
  // grabación: dos lienzos vacíos no añaden nada al "llevas 0 de 5" de arriba.
  const mostrarHistorial = historial.estado !== 'ok' || sesiones.length > 0;
  // Calculadas aquí y no en el JSX para no repetir la llamada entre la
  // condición que decide si pintar la línea y el contenido de la línea misma.
  const exclusionesHistorial = describirExclusionesDelHistorial(sesiones);
  const alcanceHistorial =
    historial.estado === 'ok' ? describirAlcance(historial.historial) : null;

  const valoraciones =
    baseline !== null && baseline.scores.status === 'ready'
      ? [
          { etiqueta: 'Claridad', comparacion: baseline.scores.clarity },
          { etiqueta: 'Confianza', comparacion: baseline.scores.confidence },
          { etiqueta: 'Ritmo', comparacion: baseline.scores.pace },
        ].filter((fila) => fila.comparacion !== null)
      : [];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {baseline === null ? (
        <>
          {/* Un bloque solo para las dos secciones: si el baseline no llegó,
              repetir el mismo mensaje bajo dos títulos sería ruido. */}
          <Text style={styles.sectionTitle}>Comparación con tu línea base</Text>

          {carga.estado === 'error' ? (
            <View style={styles.card}>
              {/* Gris y no rojo: que el servidor no responda no es algo que el
                  usuario haya hecho mal. El rojo está reservado a lo que él
                  puede arreglar. Reintentar es el botón del final. */}
              <Text style={styles.emptyText}>{carga.mensaje}</Text>
            </View>
          ) : (
            <View style={styles.cardCentrada}>
              <ActivityIndicator />
            </View>
          )}
        </>
      ) : (
        <>
          <Text style={styles.sectionTitle}>Muletillas y ritmo</Text>

          {metricasListas && baseline.metrics !== null ? (
            <View style={styles.rowsCard}>
              <ComparisonRow
                etiqueta="Muletillas"
                tendencia={ajustarPorFaltaDeSesiones(
                  TENDENCIA_MULETILLAS[baseline.metrics.filler_rate.trend],
                  baseline.metrics.filler_rate
                )}
                cifras={construirCifras(baseline.metrics.filler_rate, 'por 100 palabras')}
              />
              <ComparisonRow
                etiqueta="Velocidad"
                tendencia={ajustarPorFaltaDeSesiones(
                  TENDENCIA_RITMO[baseline.metrics.words_per_minute.trend],
                  baseline.metrics.words_per_minute
                )}
                cifras={construirCifras(baseline.metrics.words_per_minute, 'ppm')}
              />
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.emptyText}>
                {describirRecogida(
                  baseline.valid_sessions,
                  baseline.baseline_size,
                  baseline.sessions_needed
                )}
              </Text>
              {excluidas !== null && <Text style={styles.emptyText}>{excluidas}</Text>}
            </View>
          )}

          <Text style={styles.sectionTitle}>Cómo te valora el análisis</Text>

          {valoraciones.length > 0 ? (
            <View style={styles.rowsCard}>
              {valoraciones.map(({ etiqueta, comparacion }) =>
                comparacion === null ? null : (
                  <ComparisonRow
                    key={etiqueta}
                    etiqueta={etiqueta}
                    tendencia={ajustarPorFaltaDeSesiones(
                      TENDENCIA_SCORE[comparacion.trend],
                      comparacion
                    )}
                  />
                )
              )}
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.emptyText}>
                {describirRecogida(
                  baseline.scores.valid_sessions,
                  baseline.baseline_size,
                  baseline.scores.sessions_needed
                )}
              </Text>

              {/* Solo cuando las dos secciones van desacompasadas: ver métricas
                  listas y la valoración a cero parece un error si no se explica
                  que usan ventanas distintas. */}
              {metricasListas && (
                <Text style={styles.emptyText}>
                  Tus métricas ya están listas. La valoración se calcula aparte y vuelve a
                  empezar cuando cambia el modelo que analiza tus grabaciones.
                </Text>
              )}
            </View>
          )}
        </>
      )}

      {mostrarHistorial && (
        <>
          <Text style={styles.sectionTitle}>Sesión a sesión</Text>

          {historial.estado === 'cargando' && (
            <View style={styles.cardCentrada}>
              <ActivityIndicator />
            </View>
          )}

          {historial.estado === 'error' && (
            <View style={styles.card}>
              <Text style={styles.emptyText}>{historial.mensaje}</Text>
            </View>
          )}

          {historial.estado === 'ok' && (
            <>
              <MetricChart
                puntos={construirPuntos(sesiones, 'filler_rate')}
                unidad="muletillas por 100 palabras"
                referencia={referenciaMuletillas}
                descripcion="Evolución de tus muletillas, sesión a sesión."
              />

              <MetricChart
                puntos={construirPuntos(sesiones, 'words_per_minute')}
                unidad="palabras por minuto"
                referencia={referenciaRitmo}
                descripcion="Evolución de tu ritmo al hablar, sesión a sesión."
              />

              {exclusionesHistorial !== null && (
                <Text style={styles.emptyText}>{exclusionesHistorial}</Text>
              )}

              {alcanceHistorial !== null && (
                <Text style={styles.emptyText}>{alcanceHistorial}</Text>
              )}
            </>
          )}
        </>
      )}

      {/* Encima del botón y no arriba del todo, como en la lista: aquí el
          contenido va en un scroll y el botón está al final, así que un aviso
          arriba quedaría fuera de la vista de quien acaba de pulsarlo. */}
      {falloRefresco && <Text style={styles.emptyText}>No se pudo actualizar.</Text>}

      <Pressable
        style={({ pressed }) => [
          styles.secondaryButton,
          pressed && styles.buttonPressed,
          refrescando && styles.buttonDisabled,
        ]}
        onPress={actualizar}
        disabled={refrescando}
      >
        {refrescando ? (
          <ActivityIndicator />
        ) : (
          <Text style={styles.secondaryButtonText}>Actualizar</Text>
        )}
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.backButtonText}>Volver</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 24,
    gap: 16,
  },
  centrado: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#18181b',
  },
  card: {
    backgroundColor: '#f4f4f5',
    borderRadius: 8,
    padding: 16,
    gap: 8,
  },
  cardCentrada: {
    backgroundColor: '#f4f4f5',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    // Para que la tarjeta no dé un salto de alto al llegar las gráficas.
    minHeight: 96,
    justifyContent: 'center',
  },
  rowsCard: {
    backgroundColor: '#f4f4f5',
    borderRadius: 8,
    padding: 16,
    // Cada fila puede ocupar dos alturas; pegadas se leerían como una rejilla.
    gap: 14,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#71717a',
    textAlign: 'center',
  },
  secondaryButton: {
    backgroundColor: '#e4e4e7',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    // Para que el botón no cambie de tamaño al aparecer el spinner.
    alignSelf: 'stretch',
  },
  secondaryButtonText: {
    color: '#18181b',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    backgroundColor: '#e4e4e7',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  backButtonText: {
    color: '#18181b',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
