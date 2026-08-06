/**
 * Traduce los errores de Firebase Auth a mensajes legibles en español.
 *
 * Firebase lanza FirebaseError con códigos tipo "auth/invalid-credential". Ese
 * código no se le puede enseñar al usuario, y el `message` que trae encima es
 * inglés técnico con el código repetido entre paréntesis.
 *
 * Cubre los códigos de signIn y de createUser en el mismo mapa: son pocos y así
 * las dos pantallas comparten una única fuente de verdad.
 */

import { FirebaseError } from 'firebase/app';

const MENSAJES: Record<string, string> = {
  // Comunes a login y registro
  'auth/invalid-email': 'El correo no tiene un formato válido.',
  'auth/missing-password': 'Escribe tu contraseña.',
  'auth/network-request-failed':
    'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.',
  'auth/too-many-requests':
    'Demasiados intentos fallidos. Espera unos minutos antes de volver a probar.',
  'auth/internal-error': 'Error interno del servidor de autenticación. Inténtalo de nuevo.',

  // Login
  // Con la protección contra enumeración de correos activada (por defecto en
  // proyectos nuevos), Firebase ya no distingue "no existe" de "contraseña mal":
  // ambos llegan como invalid-credential. Por eso el mensaje es deliberadamente
  // ambiguo — decir "ese correo no está registrado" filtraría qué cuentas existen.
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/user-disabled': 'Esta cuenta está deshabilitada. Contacta con soporte.',

  // Registro
  'auth/email-already-in-use': 'Ya existe una cuenta con este correo.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/operation-not-allowed':
    'El registro con correo y contraseña no está habilitado en este proyecto.',
};

export function mensajeDeErrorAuth(error: unknown): string {
  if (error instanceof FirebaseError) {
    return MENSAJES[error.code] ?? `No se pudo completar la operación (${error.code}).`;
  }

  return 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}
