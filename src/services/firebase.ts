/**
 * Cliente de Firebase (SDK Web modular).
 *
 * Usamos el SDK Web y no @react-native-firebase porque la app corre en Expo Go,
 * que no admite módulos nativos fuera de los que trae el runtime.
 *
 * La config viene de las variables EXPO_PUBLIC_FIREBASE_* (ver .env.example).
 * Expo las inlinea en el bundle, por eso hay que referenciarlas con dot notation
 * literal: process.env['EXPO_PUBLIC_...'] o desestructurar NO funciona.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { getReactNativePersistence, initializeAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

/**
 * Sin esto, una variable ausente llega a Firebase como undefined y falla mucho
 * más tarde con un error opaco (p.ej. "auth/invalid-api-key") difícil de rastrear.
 */
const missing = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length > 0) {
  throw new Error(
    `Falta configuración de Firebase (${missing.join(', ')}). ` +
      'Copia .env.example a .env, rellena las EXPO_PUBLIC_FIREBASE_* y reinicia ' +
      'el servidor de Expo (las variables se inlinean al construir el bundle).'
  );
}

export const app = initializeApp(firebaseConfig);

/**
 * initializeAuth() en vez de getAuth(): getAuth() usa persistencia en memoria en
 * React Native, así que la sesión se perdería en cada reinicio de la app. Con
 * getReactNativePersistence(AsyncStorage) el token sobrevive entre arranques.
 *
 * getReactNativePersistence se importa de 'firebase/auth'. El entry point
 * 'firebase/auth/react-native' se eliminó en el SDK v11 y aquí usamos el v12.
 */
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});
