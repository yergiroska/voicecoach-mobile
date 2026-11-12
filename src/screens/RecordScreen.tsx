import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { usePreventRemove } from '@react-navigation/native';

import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { uploadRecording, type UploadedRecording } from '../services/api';
import type { AppStackScreenProps } from '../navigation/types';

/** Milisegundos a m:ss, para mostrar la duración de forma legible. */
function formatearDuracion(millis: number): string {
  const totalSegundos = Math.floor(millis / 1000);
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;
  return `${minutos}:${String(segundos).padStart(2, '0')}`;
}

/** Bytes a KB/MB, para comprobar de un vistazo que subió lo que se grabó. */
function formatearTamano(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Tamaño y tipo tal y como los recibió el servidor, saltándose lo que no llegue.
 *
 * Los dos campos son opcionales desde que api.ts valida la respuesta en vez de
 * castearla: solo `recording_id` y `text` se dan por seguros. Devuelve null si
 * no queda nada que enseñar, y entonces la línea entera desaparece en vez de
 * dejar un "0 B ·" a medias.
 */
function describirEnvio({ size_bytes, content_type }: UploadedRecording): string | null {
  const partes = [size_bytes !== null ? formatearTamano(size_bytes) : null, content_type].filter(
    (parte): parte is string => parte !== null
  );

  return partes.length > 0 ? partes.join(' · ') : null;
}

/**
 * Estado de la subida como unión discriminada: así el resultado y el mensaje de
 * error no pueden existir a la vez, ni quedar colgando de una subida anterior.
 */
type EstadoSubida =
  | { estado: 'inactiva' }
  | { estado: 'subiendo' }
  | { estado: 'ok'; grabacion: UploadedRecording }
  | { estado: 'error'; mensaje: string };

const MENSAJE_ERROR_EMPEZAR = 'No se pudo empezar a grabar. Inténtalo de nuevo.';

/**
 * Sin "inténtalo de nuevo" y sin prometer nada: si stop() falló, no sabemos si
 * el archivo quedó bien cerrado, y decir que se guardó sería mentir.
 */
const MENSAJE_ERROR_DETENER = 'No se pudo detener la grabación. Puede que no se haya guardado.';

/** Para el log: el nombre y el mensaje del error nativo, que no llevan datos del usuario. */
function describirFallo(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : typeof error;
}

/**
 * Avisa de que la grabación no se cerró bien cuando la pantalla ya se ha ido.
 *
 * Tiene que ser un diálogo y no el recuadro de la pantalla, porque la pantalla
 * ya no está. Alert.alert no hace nada en react-native-web, de ahí la rama.
 */
function avisarCierreFallido() {
  const titulo = 'La grabación no se cerró bien';
  const cuerpo = 'Puede que no se haya guardado.';

  if (Platform.OS === 'web') {
    window.alert(`${titulo}. ${cuerpo}`);
    return;
  }
  Alert.alert(titulo, cuerpo);
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
  const [subida, setSubida] = useState<EstadoSubida>({ estado: 'inactiva' });
  // Fallo del recorder al empezar o al detener. Va aparte de `subida` porque es
  // otro momento del flujo: puede fallar el grabador sin que haya subida alguna.
  const [errorGrabadora, setErrorGrabadora] = useState<string | null>(null);

  const subiendo = subida.estado === 'subiendo';
  // Se calcula aquí y no en el JSX para no repetir la llamada entre la condición
  // que decide si pintar la línea y el contenido de la línea misma.
  const detalleEnvio = subida.estado === 'ok' ? describirEnvio(subida.grabacion) : null;
  // Durante la subida se bloquea la misma interfaz que durante una transición
  // del recorder: empezar a grabar de nuevo dejaría en vuelo una petición cuyo
  // resultado ya no correspondería a la grabación que se ve en pantalla.
  const bloqueado = ocupado || subiendo;

  async function alternarGrabacion() {
    // Se fija ANTES del await: si se leyera isRecording en el catch, el recorder
    // ya podría haber cambiado de estado y el mensaje saldría al revés.
    const deteniendo = isRecording;

    // Cada pulsación es un intento nuevo: el aviso del anterior ya no aplica.
    setErrorGrabadora(null);
    setOcupado(true);
    try {
      if (deteniendo) {
        await stopRecording();
      } else {
        // Una grabación nueva invalida el resultado de la subida anterior.
        setSubida({ estado: 'inactiva' });
        await startRecording();
      }
    } catch (error) {
      console.warn(
        `[grabadora] no se pudo ${deteniendo ? 'detener' : 'empezar'} (${describirFallo(error)})`
      );
      setErrorGrabadora(deteniendo ? MENSAJE_ERROR_DETENER : MENSAJE_ERROR_EMPEZAR);
    } finally {
      // Siempre, haya ido bien o mal: si no, el botón se quedaría deshabilitado.
      setOcupado(false);
    }
  }

  async function enviarGrabacion() {
    if (recording === null) {
      return;
    }

    setSubida({ estado: 'subiendo' });
    try {
      const grabacion = await uploadRecording(recording.uri);
      setSubida({ estado: 'ok', grabacion });

      // La transcripción viene dentro de la propia respuesta, así que el
      // resultado se abre solo: no hay nada que el usuario tenga que pedir.
      //
      // Se apila con navigate en vez de sustituir la pantalla con replace para
      // que la flecha de atrás devuelva al grabador y no a Home. Y si la
      // validación de api.ts hubiera rechazado la respuesta, no llegaríamos
      // hasta aquí: el catch de abajo pinta el error y no se navega a nada.
      navigation.navigate('Transcription', { grabacion });
    } catch (error) {
      // uploadRecording ya lanza Error con mensajes pensados para enseñarse tal
      // cual; el fallback solo cubre que lo lanzado no sea un Error.
      setSubida({
        estado: 'error',
        mensaje:
          error instanceof Error ? error.message : 'No se pudo enviar la grabación.',
      });
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
      let fallo = false;
      try {
        await stopRecording();
      } catch (error) {
        fallo = true;
        console.warn(`[grabadora] no se pudo detener al salir (${describirFallo(error)})`);
      } finally {
        // En el finally, no después del await: si stop() falla no queremos
        // dejar al usuario atrapado en la pantalla. No se libera `ocupado`
        // porque la pantalla se desmonta con esta misma acción.
        navigation.dispatch(data.action);
      }

      // Después de salir, no antes: el aviso no debe frenar la salida que el
      // usuario ya confirmó.
      if (fallo) {
        avisarCierreFallido();
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
          bloqueado && styles.buttonDisabled,
        ]}
        onPress={alternarGrabacion}
        disabled={bloqueado}
      >
        <Text style={styles.buttonText}>{isRecording ? 'Detener' : 'Grabar'}</Text>
      </Pressable>

      {/* Mismo recuadro que el aviso de permiso: los dos dicen que el grabador
          no hizo lo que se le pidió. */}
      {errorGrabadora !== null && (
        <View style={styles.warning}>
          <Text style={styles.warningText}>{errorGrabadora}</Text>
        </View>
      )}

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
          {/* La URI es un file:// en el caché de la app; se muestra para poder
              comprobar a mano que la grabación existe. */}
          <Text style={styles.resultUri} numberOfLines={2}>
            {recording.uri}
          </Text>

          {/* Una vez subida se retira el botón en vez de deshabilitarlo: no hay
              motivo para volver a mandar el mismo archivo. */}
          {subida.estado === 'ok' ? (
            <View style={styles.success}>
              <Text style={styles.successTitle}>Enviada al servidor</Text>
              {detalleEnvio !== null && <Text style={styles.successLine}>{detalleEnvio}</Text>}
              {/* selectable para poder copiar el ID y buscar la grabación en el
                  backend mientras se prueba a mano. */}
              <Text style={styles.successId} selectable numberOfLines={2}>
                {subida.grabacion.recording_id}
              </Text>

              {/* Al subir ya se abrió la transcripción sola; esto es la reentrada
                  para quien retrocedió hasta aquí y quiere releerla sin tener que
                  grabar otra vez. */}
              <Pressable
                onPress={() =>
                  navigation.navigate('Transcription', { grabacion: subida.grabacion })
                }
                hitSlop={8}
              >
                <Text style={[styles.link, styles.successLink]}>Ver transcripción</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.uploadButton,
                pressed && styles.buttonPressed,
                bloqueado && styles.buttonDisabled,
              ]}
              onPress={enviarGrabacion}
              disabled={bloqueado}
            >
              {subiendo ? (
                <View style={styles.uploadingRow}>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={styles.buttonText}>Subiendo…</Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>
                  {subida.estado === 'error' ? 'Reintentar envío' : 'Enviar grabación'}
                </Text>
              )}
            </Pressable>
          )}

          {subida.estado === 'error' && (
            <Text style={styles.uploadError}>{subida.mensaje}</Text>
          )}
        </View>
      )}

      {/* El header nativo ya trae la flecha de atrás y el gesto de swipe; este es
          el camino explícito. No se deshabilita durante la grabación: goBack()
          pasa igualmente por usePreventRemove y sale el diálogo. */}
      <Pressable
        style={({ pressed }) => [
          styles.backButton,
          pressed && styles.buttonPressed,
          bloqueado && styles.buttonDisabled,
        ]}
        onPress={() => navigation.goBack()}
        disabled={bloqueado}
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
    gap: 8,
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
  uploadButton: {
    backgroundColor: '#16a34a',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  uploadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  uploadError: {
    color: '#b91c1c',
    fontSize: 13,
  },
  success: {
    backgroundColor: '#f0fdf4',
    borderRadius: 8,
    padding: 10,
    gap: 2,
  },
  successTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#15803d',
  },
  successLine: {
    fontSize: 13,
    color: '#166534',
  },
  successId: {
    fontSize: 11,
    color: '#4d7c0f',
  },
  // El recuadro usa gap: 2 para apretar los datos; el enlace es una acción y
  // necesita separarse de ellos.
  successLink: {
    marginTop: 6,
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
