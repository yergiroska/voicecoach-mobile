/**
 * Rutas de la app y sus parámetros, en un solo sitio.
 *
 * Cada stack declara su propio ParamList: el valor de cada clave es lo que esa
 * ruta espera recibir en `navigate('Ruta', params)` — `undefined` significa "sin
 * parámetros". Tipar los stacks así es lo que hace que `navigation.navigate` se
 * queje en tiempo de compilación si escribimos mal un nombre de ruta.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { UploadedRecording } from '../services/api';

/** Flujo de acceso: se muestra cuando NO hay usuario. */
export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

/** Flujo autenticado: se muestra cuando SÍ hay usuario. */
export type AppStackParamList = {
  Home: undefined;
  Record: undefined;
  /**
   * Resultado de una subida: la pantalla solo pinta lo que recibe, no vuelve a
   * pedirle nada al backend.
   *
   * Viaja el objeto entero y no solo el `recording_id` porque la transcripción
   * llega ya dentro de la respuesta de POST /recordings; con el id habría que
   * pedirla de nuevo a un endpoint que hoy no existe. Es un objeto plano de
   * strings y números, así que cumple lo que React Navigation espera de un
   * parámetro serializable.
   */
  Transcription: { grabacion: UploadedRecording };
};

/** Atajos para tipar las props de cada pantalla: navigation + route ya resueltos. */
export type AuthStackScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<
  AuthStackParamList,
  T
>;

export type AppStackScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<
  AppStackParamList,
  T
>;

/**
 * Registra las rutas en el tipo global de React Navigation. Con esto,
 * `useNavigation()` sin genérico también queda tipado en cualquier componente
 * (por ejemplo en un botón dentro de src/components), no solo en las pantallas
 * que reciben la prop `navigation`.
 */
declare global {
  namespace ReactNavigation {
    interface RootParamList extends AuthStackParamList, AppStackParamList {}
  }
}
