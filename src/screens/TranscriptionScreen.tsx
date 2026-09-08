/**
 * Resultado de una subida: el análisis de la comunicación y la transcripción.
 *
 * Es una pantalla puramente de presentación. Todo lo que enseña llega por
 * params desde RecordScreen, porque POST /recordings ya devuelve transcripción y
 * análisis hechos; no hay ninguna petición aquí ni estado de carga que gestionar.
 *
 * El análisis va ARRIBA y la transcripción debajo. Es al revés de como se
 * construyó primero, y el motivo es que el feedback es lo que se viene a ver: si
 * el texto va delante, hay que recorrer un muro de altura impredecible para
 * llegar a los scores. La transcripción queda abajo como respaldo de lo que el
 * análisis afirma.
 *
 * `analysis.model` y `analysis.prompt_version` existen en el tipo pero no se
 * pintan: son trazabilidad de ingeniería, no devolución para quien habló.
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import ScoreBar from '../components/ScoreBar';
import type { CommunicationScores, SpeechMetrics } from '../services/api';
import type { AppStackScreenProps } from '../navigation/types';

/**
 * Segundos a m:ss.
 *
 * RecordScreen tiene un formateador casi igual, pero el suyo recibe los
 * milisegundos del recorder y este los segundos (decimales) de Whisper. Con dos
 * usos y tres líneas, un módulo compartido para reconciliar las dos unidades
 * costaría más de lo que ahorra.
 */
function formatearDuracion(segundos: number): string {
  // Whisper devuelve decimales y un valor negativo no tendría sentido; se
  // redondea y se acota antes de partir para que no salga un "0:-3".
  const total = Math.max(0, Math.round(segundos));
  const minutos = Math.floor(total / 60);
  const resto = total % 60;
  return `${minutos}:${String(resto).padStart(2, '0')}`;
}

type Metadato = { etiqueta: string; valor: string };

/**
 * Los tres metadatos de la transcripción, saltándose los que no llegaron.
 *
 * La validación de api.ts los deja pasar como null a propósito: son datos de
 * apoyo, así que aquí se omite la fila en vez de enseñar un hueco o un
 * "desconocido" que no aporta nada.
 */
function recogerMetadatos(grabacion: {
  language: string | null;
  duration_seconds: number | null;
  model: string | null;
}): Metadato[] {
  const metadatos: Metadato[] = [];

  if (grabacion.language !== null) {
    // Se muestra tal cual lo manda el backend, que hoy devuelve el nombre en
    // inglés ("Spanish"): traducirlo exigiría una tabla que habría que mantener.
    metadatos.push({ etiqueta: 'Idioma', valor: grabacion.language });
  }
  if (grabacion.duration_seconds !== null) {
    metadatos.push({ etiqueta: 'Duración', valor: formatearDuracion(grabacion.duration_seconds) });
  }
  if (grabacion.model !== null) {
    metadatos.push({ etiqueta: 'Modelo', valor: grabacion.model });
  }

  return metadatos;
}

type Puntuacion = { etiqueta: string; valor: number };

/**
 * Los scores que el modelo sí pudo dar.
 *
 * Un score null no es un cero, es la ausencia de valoración, así que la barra no
 * se pinta en vez de pintarse vacía. Filtrar aquí es lo que permite que ScoreBar
 * reciba siempre un número y no cargue con este caso.
 */
function recogerScores({ clarity, confidence, pace }: CommunicationScores): Puntuacion[] {
  const puntuaciones: Puntuacion[] = [];

  if (clarity !== null) {
    puntuaciones.push({ etiqueta: 'Claridad', valor: clarity });
  }
  if (confidence !== null) {
    puntuaciones.push({ etiqueta: 'Confianza', valor: confidence });
  }
  if (pace !== null) {
    puntuaciones.push({ etiqueta: 'Ritmo', valor: pace });
  }

  return puntuaciones;
}

/**
 * Las métricas contables del habla.
 *
 * La velocidad se llama así y no "ritmo" porque "Ritmo" ya es el score del
 * modelo: dos filas con el mismo nombre y escalas distintas (0-100 frente a
 * palabras por minuto) en la misma pantalla se leerían como un error.
 */
function recogerMetricas({ word_count, words_per_minute }: SpeechMetrics): Metadato[] {
  const metricas: Metadato[] = [];

  if (word_count !== null) {
    metricas.push({ etiqueta: 'Palabras', valor: String(word_count) });
  }
  if (words_per_minute !== null) {
    metricas.push({ etiqueta: 'Velocidad', valor: `${Math.round(words_per_minute)} ppm` });
  }

  return metricas;
}

type Muletillas =
  | { estado: 'sin-analizar' }
  | { estado: 'ninguna' }
  | { estado: 'algunas'; total: number; desglose: string };

/**
 * Qué decir de las muletillas, que no es lo mismo que cuántas hubo.
 *
 * `fillers_analyzed: false` significa que el detector NO se ejecutó (su lista es
 * es-ES y el audio venía en otro idioma), y entonces el `filler_count: 0` que lo
 * acompaña no quiere decir "ninguna". Enseñar ese cero sería afirmar un logro
 * que nadie ha comprobado, así que en esa rama no se devuelve ningún número.
 *
 * Devuelve null cuando no hay nada que afirmar en ninguna dirección: la fila
 * desaparece, que es más honesto que un cero inventado.
 */
function describirMuletillas({
  fillers_analyzed,
  filler_count,
  filler_words,
}: SpeechMetrics): Muletillas | null {
  if (!fillers_analyzed) {
    return { estado: 'sin-analizar' };
  }

  // Analizadas pero sin conteo ni desglose: no sabemos el resultado.
  if (filler_count === null && filler_words.length === 0) {
    return null;
  }

  const total = filler_count ?? filler_words.reduce((suma, muletilla) => suma + muletilla.count, 0);

  if (total <= 0) {
    return { estado: 'ninguna' };
  }

  return {
    estado: 'algunas',
    total,
    desglose: filler_words.map(({ word, count }) => `${word} (${count})`).join(' · '),
  };
}

export default function TranscriptionScreen({
  route,
  navigation,
}: AppStackScreenProps<'Transcription'>) {
  const { grabacion } = route.params;
  const analisis = grabacion.analysis;

  const metadatos = recogerMetadatos(grabacion);

  // Un audio sin voz devuelve "" y eso es una respuesta válida, no un fallo. Se
  // mira con trim() porque un resultado de solo espacios deja la tarjeta en
  // blanco igual que la cadena vacía.
  const sinTexto = grabacion.text.trim() === '';

  const scores = analisis !== null ? recogerScores(analisis.scores) : [];
  const metricas = analisis !== null ? recogerMetricas(analisis.metrics) : [];
  const muletillas = analisis !== null ? describirMuletillas(analisis.metrics) : null;
  const resumen = analisis?.summary?.trim() ?? '';
  const sugerencias = analisis?.suggestions ?? [];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {metadatos.length > 0 && (
        <View style={styles.metaCard}>
          {metadatos.map(({ etiqueta, valor }) => (
            <View key={etiqueta} style={styles.metaRow}>
              <Text style={styles.metaLabel}>{etiqueta}</Text>
              <Text style={styles.metaValue}>{valor}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Con el audio en silencio el backend manda el análisis igual, pero con
          las métricas a cero y los scores a null. Enseñar "0 palabras · 0 ppm"
          debajo de un "no se detectó voz" es repetir la misma noticia con peor
          redacción, así que la sección entera no se monta. */}
      {!sinTexto && (
        <>
          <Text style={styles.sectionTitle}>Análisis</Text>

          {analisis === null ? (
            // Gris y no rojo: que el análisis falle no es un error del usuario
            // ni algo que pueda arreglar. La transcripción, que es lo que no se
            // puede recuperar, sigue ahí abajo.
            <View style={styles.card}>
              <Text style={styles.emptyText}>
                El análisis no está disponible para esta grabación.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.scoresCard}>
                {scores.length > 0 ? (
                  scores.map(({ etiqueta, valor }) => (
                    <ScoreBar key={etiqueta} etiqueta={etiqueta} valor={valor} />
                  ))
                ) : (
                  <Text style={styles.emptyText}>No se pudo puntuar esta grabación.</Text>
                )}
              </View>

              {/* Las métricas se calculan en Python y sobreviven a que el modelo
                  falle: esta tarjeta puede tener contenido con los tres scores
                  en null, y por eso va aparte de la de arriba. */}
              {(metricas.length > 0 || muletillas !== null) && (
                <View style={styles.metricsCard}>
                  {metricas.map(({ etiqueta, valor }) => (
                    <View key={etiqueta} style={styles.metaRow}>
                      <Text style={styles.metaLabel}>{etiqueta}</Text>
                      <Text style={styles.metaValue}>{valor}</Text>
                    </View>
                  ))}

                  {muletillas?.estado === 'algunas' && (
                    <>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>Muletillas</Text>
                        <Text style={styles.metaValue}>{muletillas.total}</Text>
                      </View>
                      {muletillas.desglose !== '' && (
                        <Text style={styles.desglose}>{muletillas.desglose}</Text>
                      )}
                    </>
                  )}

                  {/* El único color con carga de la pantalla, y para el caso
                      bueno: hablar sin muletillas es el mejor resultado posible
                      aquí, y en el gris de "no hay dato" se leería como un hueco. */}
                  {muletillas?.estado === 'ninguna' && (
                    <Text style={styles.logro}>Sin muletillas detectadas.</Text>
                  )}

                  {muletillas?.estado === 'sin-analizar' && (
                    <Text style={styles.emptyText}>
                      Las muletillas solo se cuentan en español.
                    </Text>
                  )}
                </View>
              )}

              {resumen !== '' && (
                <View style={styles.card}>
                  <Text style={styles.parrafo}>{resumen}</Text>
                </View>
              )}

              {sugerencias.length > 0 && (
                <View style={styles.suggestionsCard}>
                  {/* El índice como key vale aquí: la lista llega hecha y no se
                      reordena ni se filtra en ningún momento. */}
                  {sugerencias.map((sugerencia, indice) => (
                    <View key={indice} style={styles.sugerencia}>
                      <Text style={styles.vineta}>•</Text>
                      <Text style={styles.sugerenciaTexto}>{sugerencia}</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </>
      )}

      <Text style={styles.sectionTitle}>Transcripción</Text>

      {sinTexto ? (
        <View style={styles.card}>
          <Text style={styles.emptyText}>No se detectó voz en la grabación.</Text>
        </View>
      ) : (
        <View style={styles.card}>
          {/* Sin numberOfLines: el texto se lee entero y del alto se encarga el
              scroll. selectable para poder copiarlo, que es el patrón que ya usa
              el recording_id en RecordScreen (no hay expo-clipboard instalado). */}
          <Text style={styles.transcription} selectable>
            {grabacion.text}
          </Text>
        </View>
      )}

      {/* Dentro del scroll, no fijo abajo: es la acción con la que se cierra la
          lectura, y el header nativo ya deja una salida siempre a mano. */}
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
    // Sin justifyContent: 'center' — al contrario que en las demás pantallas,
    // aquí el contenido crece hacia abajo y tiene que empezar arriba.
    padding: 24,
    gap: 16,
  },
  metaCard: {
    backgroundColor: '#f4f4f5',
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  metaLabel: {
    fontSize: 13,
    color: '#71717a',
  },
  metaValue: {
    fontSize: 13,
    fontWeight: '500',
    color: '#3f3f46',
    // El nombre del modelo es largo; sin esto empuja la fila y desborda.
    flexShrink: 1,
    textAlign: 'right',
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
  },
  scoresCard: {
    backgroundColor: '#f4f4f5',
    borderRadius: 8,
    padding: 16,
    // Más aire que entre filas de texto: cada barra ocupa dos alturas y pegadas
    // se leerían como una rejilla en vez de como tres medidas distintas.
    gap: 14,
  },
  metricsCard: {
    backgroundColor: '#f4f4f5',
    borderRadius: 8,
    padding: 16,
    gap: 6,
  },
  suggestionsCard: {
    backgroundColor: '#f4f4f5',
    borderRadius: 8,
    padding: 16,
    gap: 10,
  },
  desglose: {
    fontSize: 12,
    color: '#71717a',
  },
  logro: {
    fontSize: 14,
    fontWeight: '500',
    color: '#15803d',
  },
  parrafo: {
    fontSize: 15,
    lineHeight: 22,
    color: '#18181b',
  },
  sugerencia: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  vineta: {
    fontSize: 15,
    lineHeight: 22,
    color: '#71717a',
  },
  sugerenciaTexto: {
    // Sin esto el texto no envuelve: se sale de la fila en vez de partir línea.
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: '#18181b',
  },
  transcription: {
    fontSize: 16,
    // Más aire que el resto de la app: son párrafos para leer seguido, no
    // etiquetas sueltas.
    lineHeight: 24,
    color: '#18181b',
  },
  emptyText: {
    fontSize: 14,
    color: '#71717a',
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
});
