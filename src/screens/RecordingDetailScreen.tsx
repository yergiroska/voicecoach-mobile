/**
 * Una grabación del historial, pedida por su id.
 *
 * Es la hermana de TranscriptionScreen: pintan lo mismo con el mismo
 * RecordingView, y lo único que cambia es de dónde salen los datos. Allí llegan
 * hechos por params porque la subida acaba de devolverlos; aquí hay que pedirlos
 * a GET /recordings/{id}, así que esta sí tiene estado de carga.
 *
 * Y aquí sí se pasa la fecha: al contrario que tras grabar, lo que se está
 * mirando puede ser de hace semanas.
 *
 * No lleva "Actualizar" ni pull-to-refresh: una grabación ya guardada no cambia.
 * El "Reintentar" del estado de error es otra cosa — no refresca un dato viejo,
 * vuelve a intentar una petición que falló, y un 503 o un timeout se arreglan
 * solos al segundo intento.
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import RecordingView from '../components/RecordingView';
import { getRecording, type RecordingDetail } from '../services/api';
import type { AppStackScreenProps } from '../navigation/types';

type EstadoCarga =
  | { estado: 'cargando' }
  | { estado: 'ok'; grabacion: RecordingDetail }
  | { estado: 'error'; mensaje: string };

/**
 * Pide la grabación y envuelve el fallo en el estado, sin lanzar.
 *
 * Fuera del componente porque no toca estado de React: así la usan igual la
 * carga inicial y el reintento, sin duplicar el try/catch.
 *
 * El 404 no recibe trato especial: llega con el `detail` del backend
 * ("Grabación no encontrada."), que ya es presentable. Y además no debería
 * ocurrir — a esta pantalla se entra desde la lista, que sale de /me/history y
 * solo contiene grabaciones guardadas.
 */
async function pedirGrabacion(recordingId: string): Promise<EstadoCarga> {
  try {
    return { estado: 'ok', grabacion: await getRecording(recordingId) };
  } catch (error) {
    // getRecording ya lanza Error con mensajes pensados para enseñarse tal cual;
    // el fallback solo cubre que lo lanzado no sea un Error.
    return {
      estado: 'error',
      mensaje: error instanceof Error ? error.message : 'No se pudo cargar la grabación.',
    };
  }
}

export default function RecordingDetailScreen({
  route,
  navigation,
}: AppStackScreenProps<'RecordingDetail'>) {
  const { recordingId } = route.params;

  const [carga, setCarga] = useState<EstadoCarga>({ estado: 'cargando' });

  // La petición sigue viva aunque el usuario se vaya de la pantalla; sin esta
  // comprobación, al volver escribiríamos sobre un componente desmontado.
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;

    void pedirGrabacion(recordingId).then((resultado) => {
      if (montado.current) {
        setCarga(resultado);
      }
    });

    return () => {
      montado.current = false;
    };
  }, [recordingId]);

  // Vuelve a 'cargando' sin más, al contrario que el "Actualizar" de
  // ProgressScreen: allí había contenido en pantalla que no convenía vaciar, y
  // aquí solo se reintenta desde el error, donde no hay nada que conservar.
  async function reintentar() {
    setCarga({ estado: 'cargando' });
    const resultado = await pedirGrabacion(recordingId);

    if (montado.current) {
      setCarga(resultado);
    }
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
        {/* Gris y no rojo: que el servidor no responda, o que la grabación ya no
            esté, no es algo que el usuario haya hecho mal. El rojo está
            reservado a lo que él puede arreglar. */}
        <Text style={styles.emptyText}>{carga.mensaje}</Text>

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={reintentar}
        >
          <Text style={styles.buttonText}>Reintentar</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.buttonText}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <RecordingView grabacion={carga.grabacion} fecha={carga.grabacion.recorded_at}>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.buttonText}>Volver</Text>
      </Pressable>
    </RecordingView>
  );
}

const styles = StyleSheet.create({
  centrado: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#71717a',
    textAlign: 'center',
  },
  // Un solo par de estilos para los tres botones de la pantalla: los tres son
  // secundarios y comparten aspecto, así que dos nombres distintos para el
  // mismo objeto solo invitarían a que se desincronizaran.
  button: {
    backgroundColor: '#e4e4e7',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    // En el estado de error los botones van en una columna centrada, que sin
    // esto los encoge al ancho del texto.
    alignSelf: 'stretch',
  },
  buttonText: {
    color: '#18181b',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.85,
  },
});
