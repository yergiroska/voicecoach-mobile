/**
 * Estado de sesión de Firebase Auth como hook de React.
 *
 * `loading` arranca en true porque al montar la app Firebase todavía no sabe si
 * hay sesión: tiene que leer el token de AsyncStorage (ver persistencia en
 * services/firebase.ts). Sin ese flag la app parpadearía mostrando el login a un
 * usuario que sí tiene sesión guardada.
 */

import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';

import { auth } from '../services/firebase';

type AuthState = {
  user: User | null;
  loading: boolean;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  useEffect(() => {
    // onAuthStateChanged dispara una primera vez con el estado inicial (user o
    // null) y después en cada login/logout. Devuelve la función para desuscribir.
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setState({ user, loading: false });
    });

    return unsubscribe;
  }, []);

  return state;
}
