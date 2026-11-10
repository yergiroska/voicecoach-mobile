/**
 * Resultado de una subida: la grabación que se acaba de hacer, ya transcrita y
 * analizada.
 *
 * No pide nada al servidor. POST /recordings devuelve transcripción y análisis
 * hechos, y RecordScreen pasa el objeto entero por params; aquí solo se pinta.
 * De eso se encarga RecordingView, el mismo componente que usa la pantalla del
 * historial.
 *
 * No se le pasa `fecha` a propósito: la grabación es de hace unos segundos, así
 * que la hora no aportaría nada. Y además `recorded_at` solo viene en el
 * detalle, no en la respuesta de la subida.
 */

import { Pressable, StyleSheet, Text } from 'react-native';

import RecordingView from '../components/RecordingView';
import type { AppStackScreenProps } from '../navigation/types';

export default function TranscriptionScreen({
  route,
  navigation,
}: AppStackScreenProps<'Transcription'>) {
  return (
    <RecordingView grabacion={route.params.grabacion}>
      <Pressable
        style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.backButtonText}>Volver</Text>
      </Pressable>
    </RecordingView>
  );
}

const styles = StyleSheet.create({
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
