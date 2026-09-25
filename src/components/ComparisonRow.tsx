/**
 * Una fila de la pantalla de progreso: qué se compara y hacia dónde va.
 *
 * Sirve para las dos familias de datos, y por eso las cifras son opcionales.
 * Las métricas deterministas (muletillas, ritmo) llevan números porque son
 * aritmética exacta; los scores del modelo solo la tendencia en palabras,
 * porque tienen un ruido de unos ±5 puntos entre pasadas y enseñar "de 65 a 60"
 * sería presentarle ese ruido al usuario como si fuera progreso suyo.
 *
 * Con cifras:          Muletillas                    Mejorando
 *                      23,4 → 0,0 por 100 palabras      −23,4
 *
 * Sin cifras:          Claridad                    Mucho mejor
 *
 * Es un renderizador tonto: no conoce las tendencias del backend. Traducir
 * `much_better` a "Mucho mejor" y al tono que le toca es de la pantalla, igual
 * que describirMuletillas vive en TranscriptionScreen y no en un componente.
 */

import { StyleSheet, Text, View } from 'react-native';

/**
 * Cuánta carga lleva la tendencia.
 *
 * `neutro` no es un cajón de sastre: es donde va el ritmo. Acelerar o frenar no
 * es mejorar ni empeorar —el ritmo tiene un rango adecuado y se sale por los dos
 * lados—, así que pintar "más rápido" de verde acabaría animando a atropellarse.
 * El backend evita el problema no llamándolo "improving"; aquí se evita no
 * dándole color.
 *
 * `atencion` existe para no tener que elegir entre gris y rojo cuando algo va a
 * peor: el gris se lee como "no hay dato" y el rojo, en esta app, está reservado
 * a los errores que el usuario puede arreglar.
 */
export type Tono = 'positivo' | 'atencion' | 'neutro' | 'sin-dato';

type Props = {
  etiqueta: string;
  tendencia: { texto: string; tono: Tono };
  /** Solo las métricas deterministas las traen. Ya formateadas por la pantalla. */
  cifras?: {
    antes: string;
    despues: string;
    /** Se pinta una sola vez, después del valor reciente. */
    unidad: string;
    /** Con su signo incluido. */
    delta: string;
  };
};

function estiloDeTono(tono: Tono) {
  switch (tono) {
    case 'positivo':
      return styles.tonoPositivo;
    case 'atencion':
      return styles.tonoAtencion;
    case 'neutro':
      return styles.tonoNeutro;
    case 'sin-dato':
      return styles.tonoSinDato;
  }
}

export default function ComparisonRow({ etiqueta, tendencia, cifras }: Props) {
  // Sin esto el lector de pantalla lee cuatro fragmentos sueltos y la flecha
  // como un símbolo; así la fila se anuncia como la frase que de verdad es.
  const descripcion =
    cifras === undefined
      ? `${etiqueta}: ${tendencia.texto}`
      : `${etiqueta}: ${tendencia.texto}. De ${cifras.antes} a ${cifras.despues} ${cifras.unidad}.`;

  return (
    <View accessible accessibilityLabel={descripcion} style={styles.contenedor}>
      <View style={styles.fila}>
        <Text style={styles.etiqueta}>{etiqueta}</Text>
        {/* El único elemento con color de la fila. Las cifras van en gris a
            propósito: si el número y la palabra llevaran los dos el tono, la
            misma señal se estaría dando dos veces. */}
        <Text style={[styles.tendencia, estiloDeTono(tendencia.tono)]}>{tendencia.texto}</Text>
      </View>

      {cifras !== undefined && (
        <View style={styles.fila}>
          <Text style={styles.cifras}>
            {cifras.antes} → {cifras.despues} {cifras.unidad}
          </Text>
          <Text style={styles.delta}>{cifras.delta}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    gap: 4,
  },
  fila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  etiqueta: {
    fontSize: 14,
    fontWeight: '500',
    color: '#18181b',
    // Una etiqueta larga empujaría la tendencia fuera de la fila.
    flexShrink: 1,
  },
  tendencia: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
    flexShrink: 1,
  },
  tonoPositivo: {
    color: '#15803d',
  },
  tonoAtencion: {
    // Ámbar: el color de "esto merece tu atención" sin decir que algo se ha roto.
    color: '#b45309',
  },
  tonoNeutro: {
    color: '#3f3f46',
  },
  tonoSinDato: {
    color: '#71717a',
  },
  cifras: {
    fontSize: 13,
    color: '#71717a',
    flexShrink: 1,
  },
  delta: {
    fontSize: 13,
    color: '#71717a',
    // Alinea las cifras de las filas que van una debajo de otra.
    fontVariant: ['tabular-nums'],
  },
});
