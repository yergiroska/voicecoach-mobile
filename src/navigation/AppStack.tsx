/**
 * Stack autenticado: home, grabación y el resultado (análisis y transcripción).
 *
 * Aquí sí dejamos el header nativo visible, porque es lo que da la flecha de
 * "atrás" y el gesto de swipe en RecordScreen sin escribir nada.
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from '../screens/HomeScreen';
import RecordScreen from '../screens/RecordScreen';
import TranscriptionScreen from '../screens/TranscriptionScreen';
import type { AppStackParamList } from './types';

const Stack = createNativeStackNavigator<AppStackParamList>();

export default function AppStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#fff' },
        headerTintColor: '#18181b',
        headerTitleStyle: { fontWeight: '600' },
        // El header nativo pinta su propia sombra; sin esto se ve una línea
        // sobre el fondo blanco de las pantallas.
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'VoiceCoach' }} />
      <Stack.Screen name="Record" component={RecordScreen} options={{ title: 'Grabar voz' }} />
      <Stack.Screen
        name="Transcription"
        component={TranscriptionScreen}
        options={{ title: 'Resultado' }}
      />
    </Stack.Navigator>
  );
}
