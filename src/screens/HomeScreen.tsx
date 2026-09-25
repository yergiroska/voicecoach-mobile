/**
 * PANTALLA TEMPORAL — el "hub" del flujo autenticado mientras la app real no
 * existe. Recoge lo que antes hacía App.tsx (mostrar el correo y cerrar sesión)
 * y añade las entradas a la grabación y al progreso.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { signOut } from 'firebase/auth';

import { useAuth } from '../hooks/useAuth';
import { auth } from '../services/firebase';
import { mensajeDeErrorAuth } from '../services/authErrors';
import type { AppStackScreenProps } from '../navigation/types';

export default function HomeScreen({ navigation }: AppStackScreenProps<'Home'>) {
  // El usuario ya está garantizado aquí (App.tsx no monta este stack sin sesión),
  // pero leerlo del hook evita pasarlo por params y quedarnos con un email
  // congelado si la cuenta cambia de correo.
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);

  async function cerrarSesion() {
    setError(null);
    try {
      // No hay que navegar a ninguna parte ni limpiar el historial:
      // onAuthStateChanged pone user en null, App.tsx cambia de stack y este
      // AppStack se desmonta completo.
      await signOut(auth);
    } catch (e: unknown) {
      setError(mensajeDeErrorAuth(e));
    }
  }

  return (
    <View style={styles.container}>
      {/* email es null si la cuenta se creó con un proveedor sin correo
          (teléfono, anónimo). Hoy no ocurre, pero el tipo de Firebase lo admite. */}
      <Text style={styles.greeting}>Sesión iniciada como</Text>
      <Text style={styles.email}>{user?.email ?? '(sin correo)'}</Text>

      {error !== null && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={() => navigation.navigate('Record')}
      >
        <Text style={styles.buttonText}>Grabar voz</Text>
      </Pressable>

      {/* Secundario y no primario: grabar es lo que se viene a hacer aquí, y
          consultar el progreso es la visita ocasional. */}
      <Pressable
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
        onPress={() => navigation.navigate('Progress')}
      >
        <Text style={styles.secondaryButtonText}>Mi progreso</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
        onPress={cerrarSesion}
      >
        <Text style={styles.secondaryButtonText}>Cerrar sesión</Text>
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
    gap: 12,
  },
  greeting: {
    fontSize: 15,
    color: '#71717a',
    textAlign: 'center',
  },
  email: {
    fontSize: 18,
    fontWeight: '600',
    color: '#18181b',
    textAlign: 'center',
    marginBottom: 12,
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
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#e4e4e7',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  secondaryButtonText: {
    color: '#18181b',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.85,
  },
});
