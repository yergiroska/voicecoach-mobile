/**
 * Grabación de voz sobre expo-audio (expo-av quedó deprecada y desaparece en SDK 55).
 *
 * expo-audio ya expone un hook `useAudioRecorder`, que aquí se importa con alias
 * para no chocar con el nombre de este archivo. Ese hook da el objeto recorder;
 * lo que añadimos encima es lo que la pantalla necesita y él no resuelve:
 * el permiso de micrófono, el modo de audio de iOS y la URI del último audio.
 */

import { useCallback, useState } from 'react';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder as useExpoAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';

export type Recording = {
  uri: string;
  durationMillis: number;
};

type VoiceRecorder = {
  isRecording: boolean;
  /** Duración en curso mientras se graba; vuelve a 0 al detener. */
  durationMillis: number;
  /** Última grabación terminada, o null si aún no hay ninguna. */
  recording: Recording | null;
  recordingUri: string | null;
  /** true solo si el usuario rechazó el micrófono explícitamente. */
  permissionDenied: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
};

export function useVoiceRecorder(): VoiceRecorder {
  const recorder = useExpoAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // Sondea el recorder nativo; 100 ms para que el contador de la UI no se vea
  // a saltos (el default son 500 ms).
  const status = useAudioRecorderState(recorder, 100);

  const [recording, setRecording] = useState<Recording | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const startRecording = useCallback(async () => {
    // requestRecordingPermissionsAsync no vuelve a mostrar el diálogo si ya está
    // concedido, así que sirve como "comprobar y pedir si hace falta" en una
    // sola llamada. En Android, si el usuario marcó "no volver a preguntar", el
    // sistema responde denegado sin mostrar nada.
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setPermissionDenied(true);
      return;
    }
    setPermissionDenied(false);

    // En iOS el micrófono no se abre hasta que allowsRecording es true, y sin
    // playsInSilentMode la sesión falla con el interruptor de silencio activado.
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

    // prepareToRecordAsync hay que llamarlo antes de CADA record(): el recorder
    // no queda preparado después de un stop() previo.
    await recorder.prepareToRecordAsync();
    recorder.record();

    // Se limpia al arrancar, no al parar, para que la pantalla siga mostrando la
    // grabación anterior hasta que de verdad empiece una nueva.
    setRecording(null);
  }, [recorder]);

  const stopRecording = useCallback(async () => {
    // getStatus() es sincrónico: leer la duración aquí da el valor real del
    // recorder nativo, sin el desfase del sondeo ni el reset que trae stop().
    const { durationMillis } = recorder.getStatus();

    await recorder.stop();

    // uri solo está disponible una vez que stop() resolvió.
    if (recorder.uri) {
      setRecording({ uri: recorder.uri, durationMillis });
    }

    // Devuelve el micrófono al sistema; si no, iOS deja la app con la sesión de
    // grabación abierta y baja el volumen de la reproducción posterior.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
  }, [recorder]);

  return {
    isRecording: status.isRecording,
    durationMillis: status.durationMillis,
    recording,
    recordingUri: recording?.uri ?? null,
    permissionDenied,
    startRecording,
    stopRecording,
  };
}
