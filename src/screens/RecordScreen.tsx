import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useVoiceRecorder } from '../hooks/useVoiceRecorder';

/** Milisegundos a m:ss, para mostrar la duración de forma legible. */
function formatearDuracion(millis: number): string {
  const totalSegundos = Math.floor(millis / 1000);
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;
  return `${minutos}:${String(segundos).padStart(2, '0')}`;
}

export default function RecordScreen() {
  const {
    isRecording,
    durationMillis,
    recording,
    permissionDenied,
    startRecording,
    stopRecording,
  } = useVoiceRecorder();

  // startRecording y stopRecording son asíncronas (permiso, modo de audio,
  // prepare). Sin este flag, dos toques rápidos disparan dos veces la misma
  // transición y el recorder nativo queda en un estado inconsistente.
  const [ocupado, setOcupado] = useState(false);

  async function alternarGrabacion() {
    setOcupado(true);
    try {
      if (isRecording) {
        await stopRecording();
      } else {
        await startRecording();
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Grabar voz</Text>

      <View style={styles.statusBox}>
        <Text style={[styles.status, isRecording && styles.statusRecording]}>
          {isRecording ? 'Grabando…' : 'Sin grabar'}
        </Text>
        {isRecording && <Text style={styles.timer}>{formatearDuracion(durationMillis)}</Text>}
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.button,
          isRecording && styles.buttonStop,
          pressed && styles.buttonPressed,
          ocupado && styles.buttonDisabled,
        ]}
        onPress={alternarGrabacion}
        disabled={ocupado}
      >
        <Text style={styles.buttonText}>{isRecording ? 'Detener' : 'Grabar'}</Text>
      </Pressable>

      {permissionDenied && (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            Sin permiso de micrófono no se puede grabar. Actívalo en los ajustes del sistema.
          </Text>
          <Pressable onPress={() => Linking.openSettings()} hitSlop={8}>
            <Text style={styles.link}>Abrir ajustes</Text>
          </Pressable>
        </View>
      )}

      {/* Solo cuando no se está grabando: durante la grabación el contador de
          arriba ya es la información relevante. */}
      {recording !== null && !isRecording && (
        <View style={styles.result}>
          <Text style={styles.resultTitle}>Grabación guardada</Text>
          <Text style={styles.resultLine}>
            Duración: {formatearDuracion(recording.durationMillis)}
          </Text>
          {/* La URI es un file:// en el caché de la app; se muestra solo para
              verificar a mano que la grabación existe antes de conectar la
              transcripción. */}
          <Text style={styles.resultUri} numberOfLines={2}>
            {recording.uri}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    padding: 24,
    gap: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
    color: '#18181b',
  },
  statusBox: {
    alignItems: 'center',
    gap: 4,
  },
  status: {
    fontSize: 16,
    color: '#52525b',
  },
  statusRecording: {
    color: '#b91c1c',
    fontWeight: '600',
  },
  timer: {
    fontSize: 40,
    fontWeight: '300',
    color: '#18181b',
    // Evita que el ancho de los dígitos cambie y el contador "baile".
    fontVariant: ['tabular-nums'],
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  buttonStop: {
    backgroundColor: '#b91c1c',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  warning: {
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  warningText: {
    color: '#b91c1c',
    fontSize: 14,
  },
  link: {
    color: '#2563eb',
    fontSize: 15,
    fontWeight: '500',
  },
  result: {
    backgroundColor: '#f4f4f5',
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#18181b',
  },
  resultLine: {
    fontSize: 14,
    color: '#3f3f46',
  },
  resultUri: {
    fontSize: 11,
    color: '#71717a',
  },
});
