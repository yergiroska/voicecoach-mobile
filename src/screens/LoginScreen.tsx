import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { signInWithEmailAndPassword } from 'firebase/auth';

import { auth } from '../services/firebase';
import { mensajeDeErrorAuth } from '../services/authErrors';

type Props = {
  /** Navegación provisional: la maneja App.tsx hasta que montemos React Navigation. */
  onIrARegistro: () => void;
};

export default function LoginScreen({ onIrARegistro }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function iniciarSesion() {
    // Firebase acepta cadenas vacías y responde con un error genérico; validar
    // aquí ahorra el viaje a la red y da un mensaje más concreto.
    if (!email.trim() || !password) {
      setError('Escribe tu correo y tu contraseña.');
      return;
    }

    setError(null);
    setEnviando(true);

    try {
      // No hace falta hacer nada con el resultado: onAuthStateChanged (useAuth)
      // detecta la sesión y App.tsx cambia de pantalla solo.
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e: unknown) {
      setError(mensajeDeErrorAuth(e));
      setEnviando(false);
    }
    // Si el login sale bien no llamamos a setEnviando(false): el componente se
    // desmonta enseguida y actualizar su estado sería un no-op.
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Iniciar sesión</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Correo</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="tu@correo.com"
            placeholderTextColor="#a1a1aa"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            editable={!enviando}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Contraseña</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor="#a1a1aa"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            editable={!enviando}
            onSubmitEditing={iniciarSesion}
            returnKeyType="go"
          />
        </View>

        {error !== null && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            enviando && styles.buttonDisabled,
          ]}
          onPress={iniciarSesion}
          disabled={enviando}
        >
          {enviando ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Iniciar sesión</Text>
          )}
        </Pressable>

        <Pressable onPress={onIrARegistro} disabled={enviando} hitSlop={8}>
          <Text style={styles.link}>¿No tienes cuenta? Regístrate</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
    color: '#18181b',
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#3f3f46',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: '#18181b',
    backgroundColor: '#fff',
  },
  error: {
    color: '#b91c1c',
    fontSize: 14,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    backgroundColor: '#93b4f5',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  link: {
    textAlign: 'center',
    color: '#2563eb',
    fontSize: 15,
  },
});
