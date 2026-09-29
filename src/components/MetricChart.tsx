/**
 * La evolución de una métrica, sesión a sesión.
 *
 * Renderizador tonto, como ComparisonRow: no conoce `HistorySession` ni las
 * unidades del backend. La pantalla mapea y da el título; aquí solo se dibuja.
 *
 * Usa la API v2 de react-native-chart-kit (`react-native-chart-kit/v2`), no la
 * clásica. La clásica no sirve: su `Dataset.data` es `number[]` y no admite
 * huecos, que es justo lo que hace falta aquí.
 */

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit/v2';
import { Circle } from 'react-native-svg';

/** El azul de las acciones del proyecto, el mismo que usa ScoreBar. */
const AZUL = '#2563eb';
const GRIS_REFERENCIA = '#71717a';

const ALTO = 180;

export type PuntoGrafica = {
  /**
   * Identificador único del punto en el eje X. NO es la etiqueta.
   *
   * La escala ordinal de la librería construye su dominio con `unique()` sobre
   * los valores X, así que dos puntos con el mismo valor colapsan en la misma
   * coordenada. Pasar aquí la fecha amontonaba todas las sesiones de un mismo
   * día en un solo sitio: con doce sesiones repartidas en dos días salían dos
   * columnas de puntos superpuestos en vez de doce posiciones.
   *
   * Con una clave única por sesión el dominio tiene tantas entradas como
   * sesiones y todas pesan lo mismo, que es lo que se buscaba.
   */
  clave: string;
  /** Lo que se lee bajo el punto. Puede repetirse entre sesiones del mismo día. */
  etiqueta: string;
  /**
   * Null cuando esa sesión no tiene este dato.
   *
   * No es lo mismo que cero: puede ser una sesión inválida, o una válida cuyo
   * audio no trajo duración. Se dibuja como hueco.
   */
  valor: number | null;
  /** Si forma parte de la línea base. Cambia cómo se pinta el punto. */
  enLineaBase: boolean;
};

type Props = {
  puntos: PuntoGrafica[];
  /** Se añade a las etiquetas del eje Y. */
  unidad: string;
  /** Línea horizontal de referencia. Solo cuando la línea base ya está fijada. */
  referencia?: { valor: number; etiqueta: string };
  /** Para el lector de pantalla: el título visible lo pone la pantalla. */
  descripcion: string;
};

export default function MetricChart({ puntos, unidad, referencia, descripcion }: Props) {
  // Se mide en vez de calcular la anchura restando paddings: así el componente
  // no tiene que saber cómo está maquetada la pantalla que lo usa, y la
  // rotación del dispositivo se resuelve sola.
  const [ancho, setAncho] = useState(0);

  // Una serie entera de nulos no es una gráfica vacía, es que no hay nada que
  // dibujar: puede pasar si todas las sesiones fueron inválidas, o si ninguna
  // trajo duración de audio.
  const hayDatos = puntos.some((punto) => punto.valor !== null);

  if (!hayDatos) {
    return (
      <View style={styles.card}>
        <Text style={styles.vacio}>Aún no hay datos que dibujar.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View onLayout={({ nativeEvent }) => setAncho(nativeEvent.layout.width)}>
        {ancho > 0 && (
          <LineChart
            data={puntos}
            xKey="clave"
            series={[{ yKey: 'valor', color: AZUL, strokeWidth: 2, curve: 'linear' }]}
            width={ancho}
            height={ALTO}
            // El hueco se queda hueco. Unir los extremos dibujaría una pendiente
            // entre dos sesiones no consecutivas, que es una tendencia que nadie
            // midió.
            connectNulls={false}
            showHorizontalGridLines
            // 'auto' decide solo si rota, escalona o se salta etiquetas del eje
            // X. Con treinta fechas, sin esto se pisarían.
            labelStrategy="auto"
            // La etiqueta se busca por posición porque el valor del eje es la
            // clave, que no se enseña. Se llama una vez por fila, y con
            // labelStrategy 'auto' la librería descarta los textos repetidos:
            // las diez sesiones de un mismo día dejan una sola fecha escrita.
            formatXLabel={(_valor, indice) => puntos[indice]?.etiqueta ?? ''}
            formatYLabel={(valor) => `${Math.round(valor)}`}
            referenceLines={
              referencia === undefined
                ? undefined
                : [
                    {
                      y: referencia.valor,
                      label: referencia.etiqueta,
                      // A la izquierda, no en el borde derecho que trae por
                      // defecto: ahí está la sesión más reciente, que es la que
                      // más interesa ver sin nada encima.
                      labelPosition: 'start',
                      // Recuadro detrás del texto, del color del área de la
                      // gráfica. La librería ya intenta esquivar la serie
                      // eligiendo entre arriba y abajo, pero cuando las dos
                      // opciones chocan se queda con la menos mala y el texto
                      // acaba sobre un punto igualmente. El fondo lo deja
                      // legible pase lo que pase.
                      labelContainer: { opacity: 1 },
                      color: GRIS_REFERENCIA,
                      strokeDasharray: [4, 4],
                      strokeWidth: 1,
                    },
                  ]
            }
            // Solo se invoca en puntos con valor: la capa de marcadores filtra
            // por `defined` antes de llamar aquí, así que las sesiones sin dato
            // nunca pasan por esta función (verificado en el código de la v2).
            renderDot={({ x, y, point, color }) => {
              const dato = point.raw as PuntoGrafica | undefined;
              const enLineaBase = dato?.enLineaBase === true;

              return (
                // Las de la línea base van huecas y el resto sólidas: es el
                // tramo contra el que se compara todo lo demás, no un valor
                // mejor ni peor.
                <Circle
                  cx={x}
                  cy={y}
                  r={enLineaBase ? 4 : 3.5}
                  fill={enLineaBase ? '#fff' : color}
                  stroke={color}
                  strokeWidth={2}
                />
              );
            }}
            accessibilityLabel={descripcion}
          />
        )}
      </View>

      <Text style={styles.unidad}>{unidad}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f4f4f5',
    borderRadius: 8,
    padding: 16,
    gap: 8,
  },
  unidad: {
    fontSize: 12,
    color: '#71717a',
    textAlign: 'right',
  },
  vacio: {
    fontSize: 14,
    color: '#71717a',
  },
});
