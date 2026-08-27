import { useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';

import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import type { AppStackScreenProps } from '../navigation/types';

/** Milisegundos a m:ss, para mostrar la duración de forma legible. */
function formatearDuracion(millis: number): string {
  const totalSegundos = Math.floor(millis / 1000);
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;
  return `${minutos}:${String(segundos).padStart(2, '0')}`;
}

export default function RecordScreen({ navigation }: AppStackScreenProps<'Record'>) {
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

  /**
   * Intercepta cualquier salida de la pantalla mientras se graba: la flecha del
   * header, el back de hardware de Android, el gesto de swipe de iOS y nuestro
   * propio goBack(). React Navigation nos entrega en `data.action` la acción que
   * bloqueó, y salir consiste en volver a despacharla.
   *
   * No se cancela la grabación al salir, se cierra: sin el stop() el recorder
   * nativo se queda con el micrófono abierto cuando la pantalla se desmonta.
   */
  usePreventRemove(isRecording, ({ data }) => {
    async function detenerYSalir() {
      setOcupado(true);
      try {
        await stopRecording();
      } finally {
        // En el finally, no después del await: si stop() falla no queremos
        // dejar al usuario atrapado en la pantalla.
        navigation.dispatch(data.action);
      }
    }

    // Alert.alert no hace nada en react-native-web, así que ahí el diálogo
    // nativo del navegador es la única forma de no bloquear la salida.
    if (Platform.OS === 'web') {
      if (window.confirm('Estás grabando. ¿Detener la grabación y salir?')) {
        void detenerYSalir();
      }
      return;
    }

    Alert.alert('Estás grabando', '¿Detener la grabación y salir de esta pantalla?', [
      { text: 'Seguir grabando', style: 'cancel' },
      { text: 'Detener y salir', style: 'destructive', onPress: () => void detenerYSalir() },
    ]);
  });

  return (
    <View style={styles.container}>
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

      {/* El header nativo ya trae la flecha de atrás y el gesto de swipe; este es
          el camino explícito. No se deshabilita durante la grabación: goBack()
          pasa igualmente por usePreventRemove y sale el diálogo. */}
      <Pressable
        style={({ pressed }) => [
          styles.backButton,
          pressed && styles.buttonPressed,
          ocupado && styles.buttonDisabled,
        ]}
        onPress={() => navigation.goBack()}
        disabled={ocupado}
      >
        <Text style={styles.backButtonText}>Volver a Home</Text>
      </Pressable>
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
});
