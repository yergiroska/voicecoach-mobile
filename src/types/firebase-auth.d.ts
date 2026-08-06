/**
 * Parche de tipos para getReactNativePersistence (firebase 12.17.1).
 *
 * El campo "exports" de @firebase/auth pone la clave "types" ANTES de la
 * condición "react-native". Las condiciones se resuelven en orden, así que
 * TypeScript siempre cae en dist/auth-public.d.ts (los tipos de navegador),
 * que no declaran getReactNativePersistence, y da error TS2305.
 *
 * En runtime no hay problema: Metro sí aplica la condición "react-native" y
 * resuelve a dist/rn/index.js, que exporta la función (línea 244 del bundle).
 * Es decir, solo faltan los tipos; la función existe.
 *
 * Persistence y ReactNativeAsyncStorage sí están en auth-public.d.ts, así que
 * la firma queda completa. Revisar si futuras versiones de firebase lo arreglan:
 * si este bloque empieza a dar "duplicate identifier", se puede borrar.
 */

import type { Persistence, ReactNativeAsyncStorage } from 'firebase/auth';

declare module 'firebase/auth' {
  export function getReactNativePersistence(
    storage: ReactNativeAsyncStorage
  ): Persistence;
}
