/**
 * Una grabación entera: sus metadatos, el análisis de la comunicación y la
 * transcripción.
 *
 * Lo usan las dos pantallas que enseñan una grabación —la que llega justo
 * después de subirla y la que se abre desde el historial— porque el backend
 * devuelve la misma forma en los dos casos a propósito. De ahí que se tipe
 * sobre `RecordingBase`: lo que distingue a una respuesta de la otra
 * (`filename` en la subida, `recorded_at` en el detalle) no se pinta aquí, y la
 * fecha entra por una prop aparte.
 *
 * No sabe nada de navegación. El pie llega como `children`, dentro del scroll,
 * para que cada pantalla ponga el botón que le corresponda.
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

import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import ScoreBar from './ScoreBar';
import type { CommunicationScores, RecordingBase, SpeechMetrics } from '../services/api';

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

/**
 * La fecha y la hora de la grabación, o null si no hay nada que enseñar.
 *
 * Se compone a mano, como la del eje de las gráficas: el soporte de Intl en
 * Hermes no es igual en las dos plataformas. Esta sí lleva año y hora, porque
 * aquí se está mirando una grabación concreta y no una serie.
 */
function formatearFecha(iso: string | null | undefined): string | null {
  if (iso === null || iso === undefined) {
    return null;
  }

  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) {
    return null;
  }

  const dia = `${fecha.getDate()}/${fecha.getMonth() + 1}/${fecha.getFullYear()}`;
  const hora = `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`;
  return `${dia} · ${hora}`;
}

/**
 * Los idiomas más probables, en español.
 *
 * El backend manda lo que devuelve Whisper: hoy el nombre en inglés
 * ("Spanish"), pero se acepta también el código de dos letras por si cambia de
 * formato. Corta a propósito: un idioma que no esté aquí se enseña tal cual, que
 * es como se enseñaban todos antes, así que olvidarse de uno no rompe nada.
 */
const NOMBRE_IDIOMA: Record<string, string> = {
  spanish: 'Español',
  es: 'Español',
  english: 'Inglés',
  en: 'Inglés',
  portuguese: 'Portugués',
  pt: 'Portugués',
  french: 'Francés',
  fr: 'Francés',
  italian: 'Italiano',
  it: 'Italiano',
  german: 'Alemán',
  de: 'Alemán',
  catalan: 'Catalán',
  ca: 'Catalán',
};

/** El idioma en español si está en la tabla, sin mirar mayúsculas; si no, tal cual. */
function traducirIdioma(idioma: string): string {
  return NOMBRE_IDIOMA[idioma.trim().toLowerCase()] ?? idioma;
}

type Metadato = { etiqueta: string; valor: string };

/**
 * Los metadatos de la grabación, saltándose los que no llegaron.
 *
 * La validación de api.ts los deja pasar como null a propósito: son datos de
 * apoyo, así que aquí se omite la fila en vez de enseñar un hueco o un
 * "desconocido" que no aporta nada. La fecha sigue la misma regla y además solo
 * existe en el detalle.
 *
 * `model` (el de Whisper) no se enseña, por lo mismo que `analysis.model`: es
 * trazabilidad de ingeniería, no algo que le diga nada a quien habló.
 */
function recogerMetadatos(
  grabacion: {
    language: string | null;
    duration_seconds: number | null;
  },
  fecha: string | null | undefined
): Metadato[] {
  const metadatos: Metadato[] = [];

  const cuando = formatearFecha(fecha);
  if (cuando !== null) {
    metadatos.push({ etiqueta: 'Fecha', valor: cuando });
  }
  if (grabacion.language !== null) {
    metadatos.push({ etiqueta: 'Idioma', valor: traducirIdioma(grabacion.language) });
  }
  if (grabacion.duration_seconds !== null) {
    metadatos.push({ etiqueta: 'Duración', valor: formatearDuracion(grabacion.duration_seconds) });
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

type Props = {
  grabacion: RecordingBase;
  /**
   * Cuándo se grabó, en ISO. Solo la pasa la pantalla de detalle: en la que
   * llega tras subir, la grabación acaba de hacerse y la fecha no aporta nada.
   */
  fecha?: string | null;
  /** El pie, dentro del scroll: cada pantalla pone su propio botón. */
  children?: ReactNode;
};

export default function RecordingView({ grabacion, fecha, children }: Props) {
  const analisis = grabacion.analysis;

  const metadatos = recogerMetadatos(grabacion, fecha);

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

      {/* El pie va dentro del scroll, no fijo abajo: es la acción con la que se
          cierra la lectura, y el header nativo ya deja una salida a mano. */}
      {children}
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
  // Los grises de este componente van todos dentro de tarjetas #f4f4f5, donde
  // #71717a se queda en unos 4,4:1 y no llega al 4,5:1 de AA. De ahí #52525b
  // aquí, en desglose, viñeta y emptyText.
  metaLabel: {
    fontSize: 13,
    color: '#52525b',
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
    color: '#52525b',
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
    color: '#52525b',
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
    color: '#52525b',
  },
});
