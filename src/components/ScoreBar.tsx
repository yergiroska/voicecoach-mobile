/**
 * Barra de un score de comunicación, de 0 a 100.
 *
 * Primer componente compartido del proyecto. Hasta ahora cada pantalla se
 * pintaba sola porque no había nada repetido de verdad; aquí sí: son tres
 * instancias idénticas en la misma pantalla.
 *
 * Un color único para las tres barras, a propósito. Un semáforo rojo/ámbar/verde
 * convertiría cada score en un veredicto, y un 55 en confianza no es un suspenso
 * fuera de contexto. El azul es el mismo de las acciones del proyecto.
 */

import { StyleSheet, Text, View } from 'react-native';

type Props = {
  etiqueta: string;
  /** De 0 a 100. Los scores nulos los descarta la pantalla: aquí llega un número. */
  valor: number;
};

export default function ScoreBar({ etiqueta, valor }: Props) {
  // El backend ya descarta lo que se sale de 0-100, pero de este número depende
  // el ancho del relleno: un valor colado pintaría una barra más larga que su
  // propia pista. Se redondea porque el ancho se expresa en porcentaje entero.
  const porcentaje = Math.max(0, Math.min(100, Math.round(valor)));

  return (
    // El lector de pantalla anunciaría "78" suelto sin esto: la barra no tiene
    // texto que explique de qué es ese número ni sobre cuánto.
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={etiqueta}
      accessibilityValue={{ min: 0, max: 100, now: porcentaje }}
      style={styles.contenedor}
    >
      <View style={styles.fila}>
        <Text style={styles.etiqueta}>{etiqueta}</Text>
        {/* El número siempre visible: el largo de la barra no puede ser el único
            portador del dato, ni para quien no distingue bien los colores ni
            para quien quiere saber si es un 70 o un 80. */}
        <Text style={styles.valor}>{porcentaje}</Text>
      </View>

      <View style={styles.pista}>
        <View style={[styles.relleno, { width: `${porcentaje}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    gap: 6,
  },
  fila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  etiqueta: {
    fontSize: 14,
    color: '#3f3f46',
  },
  valor: {
    fontSize: 14,
    fontWeight: '600',
    color: '#18181b',
    // Alinea verticalmente las cifras de las tres barras, que van una debajo de
    // otra. Es el mismo recurso que usa el contador de RecordScreen.
    fontVariant: ['tabular-nums'],
  },
  pista: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#e4e4e7',
    // Sin esto, el relleno asoma por fuera de las esquinas redondeadas.
    overflow: 'hidden',
  },
  relleno: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#2563eb',
  },
});
