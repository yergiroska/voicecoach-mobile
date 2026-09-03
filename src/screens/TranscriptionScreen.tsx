/**
 * Resultado de una subida: los metadatos de la grabación y su transcripción.
 *
 * Es una pantalla puramente de presentación. Todo lo que enseña llega por
 * params desde RecordScreen, porque POST /recordings ya devuelve la
 * transcripción hecha; no hay ninguna petición aquí ni estado de carga que
 * gestionar.
 *
 * Va aparte de RecordScreen y no como un bloque más dentro de ella por el
 * tamaño del contenido: la transcripción no tiene una altura previsible, y
 * RecordScreen está centrada y sin scroll porque su contenido sí lo es.
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
    // Se muestra tal cual lo manda el backend: hoy es un código ISO ("es"), y
    // traducirlo a un nombre exigiría una tabla que habría que mantener.
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

export default function TranscriptionScreen({
  route,
  navigation,
}: AppStackScreenProps<'Transcription'>) {
  const { grabacion } = route.params;

  const metadatos = recogerMetadatos(grabacion);

  // Un audio sin voz devuelve "" y eso es una respuesta válida, no un fallo. Se
  // mira con trim() porque un resultado de solo espacios deja la tarjeta en
  // blanco igual que la cadena vacía.
  const sinTexto = grabacion.text.trim() === '';

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
