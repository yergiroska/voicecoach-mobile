import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';

import { useAuth } from './src/hooks/useAuth';
import AuthStack from './src/navigation/AuthStack';
import AppStack from './src/navigation/AppStack';

/**
 * Raíz de la app: un único NavigationContainer y, dentro, el stack que
 * corresponda al estado de sesión.
 *
 * Los dos stacks se alternan como hermanos condicionales (no como rutas del
 * mismo navegador) a propósito: al cambiar `user`, React Navigation desmonta el
 * stack anterior y monta el otro desde cero. Así, tras cerrar sesión no queda
 * historial de la sesión previa al que se pueda volver con el botón "atrás", y
 * no hace falta resetear nada a mano.
 */
export default function App() {
  const { user, loading } = useAuth();

  // Mientras Firebase resuelve si hay sesión guardada no montamos ningún stack:
  // si mostráramos AuthStack aquí, el usuario con sesión vería el login
  // parpadear un instante antes de que llegue onAuthStateChanged.
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
        <Text style={styles.muted}>Cargando…</Text>
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {user !== null ? <AppStack /> : <AuthStack />}
      <StatusBar style="auto" />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  muted: {
    color: '#666',
  },
});
