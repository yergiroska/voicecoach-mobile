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
import {
  getBaseline,
  type Baseline,
  type FillerTrend,
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

export default function ProgressScreen({ navigation }: AppStackScreenProps<'Progress'>) {
  const [carga, setCarga] = useState<EstadoCarga>({ estado: 'cargando' });
  // Separado del estado: al actualizar, la pantalla NO vuelve a 'cargando'. Si
  // lo hiciera, el contenido desaparecería y volvería a aparecer, que es peor
  // que verlo quieto un segundo mientras el spinner gira en el botón.
  const [refrescando, setRefrescando] = useState(false);

  // La petición sigue viva aunque el usuario se vaya de la pantalla; sin esta
  // comprobación, al volver escribiríamos sobre un componente desmontado.
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;

    void pedirBaseline().then((resultado) => {
      if (montado.current) {
        setCarga(resultado);
      }
    });

    return () => {
      montado.current = false;
    };
  }, []);

  async function actualizar() {
    setRefrescando(true);
    const resultado = await pedirBaseline();

    if (!montado.current) {
      return;
    }
    setCarga(resultado);
    setRefrescando(false);
  }

  if (carga.estado === 'cargando') {
    return (
      <View style={styles.centrado}>
        <ActivityIndicator />
        <Text style={styles.emptyText}>Cargando…</Text>
      </View>
    );
  }

  if (carga.estado === 'error') {
    return (
      <View style={styles.centrado}>
        {/* Gris y no rojo: que el servidor no responda no es algo que el usuario
            haya hecho mal. El rojo está reservado a lo que él puede arreglar. */}
        <Text style={styles.emptyText}>{carga.mensaje}</Text>

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
            <Text style={styles.secondaryButtonText}>Reintentar</Text>
          )}
        </Pressable>
      </View>
    );
  }

  const { baseline } = carga;
  const { scores } = baseline;

  const metricasListas = baseline.status === 'ready' && baseline.metrics !== null;
  const excluidas = describirExcluidas(baseline.excluded_sessions);

  const valoraciones =
    scores.status === 'ready'
      ? [
          { etiqueta: 'Claridad', comparacion: scores.clarity },
          { etiqueta: 'Confianza', comparacion: scores.confidence },
          { etiqueta: 'Ritmo', comparacion: scores.pace },
        ].filter((fila) => fila.comparacion !== null)
      : [];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
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
              scores.valid_sessions,
              baseline.baseline_size,
              scores.sessions_needed
            )}
          </Text>

          {/* Solo cuando las dos secciones van desacompasadas: ver métricas
              listas y la valoración a cero parece un error si no se explica que
              usan ventanas distintas. */}
          {metricasListas && (
            <Text style={styles.emptyText}>
              Tus métricas ya están listas. La valoración se calcula aparte y vuelve a empezar
              cuando cambia el modelo que analiza tus grabaciones.
            </Text>
          )}
        </View>
      )}

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
