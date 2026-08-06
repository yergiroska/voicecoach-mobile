import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { signOut } from 'firebase/auth';

import { useAuth } from './src/hooks/useAuth';
import { auth } from './src/services/firebase';
import { mensajeDeErrorAuth } from './src/services/authErrors';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';

/**
 * Enrutado provisional. Sustituir por React Navigation en la siguiente fase:
 * useAuth decide entre el flujo autenticado y el de acceso, y un useState local
 * alterna entre login y registro mientras no hay sesión.
 */
export default function App() {
  const { user, loading } = useAuth();
  const [pantalla, setPantalla] = useState<'login' | 'registro'>('login');

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
        <Text style={styles.muted}>Cargando…</Text>
        <StatusBar style="auto" />
      </View>
    );
  }

  if (!user) {
    return (
      <>
        {pantalla === 'login' ? (
          <LoginScreen onIrARegistro={() => setPantalla('registro')} />
        ) : (
          <RegisterScreen onIrALogin={() => setPantalla('login')} />
        )}
        <StatusBar style="auto" />
      </>
    );
  }

  return <SesionIniciada email={user.email} />;
}

/**
 * PANTALLA TEMPORAL — solo confirma que el ciclo login/registro/logout funciona
 * de punta a punta. Sustituir por la app real (navegación + pantallas) después.
 */
function SesionIniciada({ email }: { email: string | null }) {
  const [error, setError] = useState<string | null>(null);

  async function cerrarSesion() {
    setError(null);
    try {
      // No hay que limpiar nada más: onAuthStateChanged pone user en null y App
      // vuelve al login solo.
      await signOut(auth);
    } catch (e: unknown) {
      setError(mensajeDeErrorAuth(e));
    }
  }

  return (
    <View style={styles.centered}>
      {/* email es null si la cuenta se creó con un proveedor sin correo (teléfono,
          anónimo). Hoy no ocurre, pero el tipo de Firebase lo admite. */}
      <Text style={styles.title}>Sesión iniciada como {email ?? '(sin correo)'}</Text>

      {error !== null && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={cerrarSesion}
      >
        <Text style={styles.buttonText}>Cerrar sesión</Text>
      </Pressable>

      <StatusBar style="auto" />
    </View>
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
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    color: '#18181b',
  },
  muted: {
    color: '#666',
  },
  error: {
    color: '#b91c1c',
    fontSize: 14,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#e4e4e7',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#18181b',
    fontSize: 16,
    fontWeight: '600',
  },
});
