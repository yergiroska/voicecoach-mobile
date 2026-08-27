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
import { createUserWithEmailAndPassword } from 'firebase/auth';

import { auth } from '../services/firebase';
import { mensajeDeErrorAuth } from '../services/authErrors';
import type { AuthStackScreenProps } from '../navigation/types';

/** Mínimo que exige Firebase. Validarlo aquí evita un ida y vuelta a la red. */
const MIN_PASSWORD = 6;

export default function RegisterScreen({ navigation }: AuthStackScreenProps<'Register'>) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function registrar() {
    if (!email.trim() || !password) {
      setError('Escribe tu correo y tu contraseña.');
      return;
    }

    if (password.length < MIN_PASSWORD) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
      return;
    }

    // Va después de la validación de longitud: si la contraseña es corta, ese es
    // el problema que hay que señalar aunque además no coincidan.
    if (password !== confirmacion) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setError(null);
    setEnviando(true);

    try {
      // createUserWithEmailAndPassword deja la sesión iniciada al crear la cuenta,
      // así que onAuthStateChanged (useAuth) dispara y App.tsx cambia de pantalla
      // sin pasar por el login.
      await createUserWithEmailAndPassword(auth, email.trim(), password);
    } catch (e: unknown) {
      setError(mensajeDeErrorAuth(e));
      setEnviando(false);
    }
    // Como en el login: si sale bien, el componente se desmonta y no hay estado
    // que restaurar.
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Crear cuenta</Text>

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
            placeholder="Mínimo 6 caracteres"
            placeholderTextColor="#a1a1aa"
            secureTextEntry
            autoCapitalize="none"
            // "new-password" (y no "current-password") para que el gestor de
            // contraseñas ofrezca generar una, en vez de autocompletar una vieja.
            autoComplete="new-password"
            textContentType="newPassword"
            editable={!enviando}
            returnKeyType="next"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Repetir contraseña</Text>
          <TextInput
            style={styles.input}
            value={confirmacion}
            onChangeText={setConfirmacion}
            placeholder="Vuelve a escribirla"
            placeholderTextColor="#a1a1aa"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            editable={!enviando}
            onSubmitEditing={registrar}
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
          onPress={registrar}
          disabled={enviando}
        >
          {enviando ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Crear cuenta</Text>
          )}
        </Pressable>

        <Pressable onPress={() => navigation.goBack()} disabled={enviando} hitSlop={8}>
          <Text style={styles.link}>¿Ya tienes cuenta? Inicia sesión</Text>
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
