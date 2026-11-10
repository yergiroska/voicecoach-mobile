/**
 * Todas las grabaciones del usuario, de la más reciente a la más antigua.
 *
 * Primera lista del proyecto. Se apoya en /me/history, el mismo endpoint que
 * alimenta las gráficas de progreso, porque ya trae por sesión lo justo para
 * pintar una fila sin pedir el detalle de cada una.
 *
 * Las sesiones que no cuentan se listan igual y se pueden abrir: una grabación
 * demasiado corta o en otro idioma no entra en las métricas, pero tiene
 * transcripción, y esconderla dejaría al usuario sin saber qué grabó.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  getHistory,
  type ExcludedReason,
  type History,
  type HistorySession,
} from '../services/api';
import type { AppStackScreenProps } from '../navigation/types';

/** El máximo que admite el endpoint. No hay paginación hacia atrás. */
const LIMITE = 100;

/** Referencia estable para que useMemo no recalcule mientras no hay datos. */
const SIN_SESIONES: HistorySession[] = [];

const MOTIVO_EXCLUSION: Record<ExcludedReason, string> = {
  too_short: 'muy corta',
  other_language: 'en otro idioma',
  not_analyzed: 'sin analizar',
};

/**
 * Fecha y hora de una grabación.
 *
 * Compuesta a mano y no con toLocaleDateString, por lo de siempre: el soporte
 * de Intl en Hermes no es igual en las dos plataformas.
 */
function formatearFechaHora(iso: string): string {
  const fecha = new Date(iso);

  if (Number.isNaN(fecha.getTime())) {
    return '';
  }

  const dia = `${fecha.getDate()}/${fecha.getMonth() + 1}/${fecha.getFullYear()}`;
  const hora = `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`;
  return `${dia} · ${hora}`;
}

/**
 * Lo que se enseña a la derecha de la fila.
 *
 * Una sesión inválida no trae métricas, así que en su lugar va el motivo. Y una
 * válida puede no tener ritmo —si el audio no trajo duración— sin dejar de
 * contar para lo demás: por eso se arma la frase con lo que haya en vez de dar
 * por hecho que están los dos datos.
 */
function describirSesion(sesion: HistorySession): { texto: string; atenuado: boolean } {
  if (!sesion.valid) {
    const motivo = sesion.excluded_reason === null ? null : MOTIVO_EXCLUSION[sesion.excluded_reason];
    return { texto: motivo ?? 'no cuenta', atenuado: true };
  }

  const partes: string[] = [];
  if (sesion.word_count !== null) {
    partes.push(`${sesion.word_count} palabras`);
  }
  if (sesion.words_per_minute !== null) {
    partes.push(`${Math.round(sesion.words_per_minute)} ppm`);
  }

  return { texto: partes.join(' · '), atenuado: false };
}

type EstadoCarga =
  | { estado: 'cargando' }
  | { estado: 'ok'; historial: History }
  | { estado: 'error'; mensaje: string };

/** Pide el historial y envuelve el fallo en el estado, sin lanzar. */
async function pedirHistorial(): Promise<EstadoCarga> {
  try {
    return { estado: 'ok', historial: await getHistory(LIMITE) };
  } catch (error) {
    return {
      estado: 'error',
      mensaje: error instanceof Error ? error.message : 'No se pudo cargar tu historial.',
    };
  }
}

export default function RecordingsScreen({ navigation }: AppStackScreenProps<'Recordings'>) {
  const [carga, setCarga] = useState<EstadoCarga>({ estado: 'cargando' });
  const [refrescando, setRefrescando] = useState(false);
  // Un fallo al refrescar no vacía la pantalla, solo levanta este aviso.
  const [falloRefresco, setFalloRefresco] = useState(false);

  const montado = useRef(true);

  const sesiones = carga.estado === 'ok' ? carga.historial.sessions : SIN_SESIONES;

  // El endpoint las manda de la más antigua a la más nueva porque así se dibujan
  // las gráficas. Una lista quiere lo contrario, y se invierte UNA COPIA: darle
  // la vuelta al array del estado lo mutaría y rompería la gráfica, que lee el
  // mismo dato en el orden original.
  const recientesPrimero = useMemo(() => [...sesiones].reverse(), [sesiones]);

  useEffect(() => {
    montado.current = true;

    void pedirHistorial().then((resultado) => {
      if (montado.current) {
        setCarga(resultado);
      }
    });

    return () => {
      montado.current = false;
    };
  }, []);

  /**
   * Reintento desde el error de la primera carga, donde no hay nada en pantalla
   * que conservar: se vuelve a 'cargando' y lo que salga manda.
   */
  async function reintentar() {
    setCarga({ estado: 'cargando' });
    setFalloRefresco(false);

    const resultado = await pedirHistorial();
    if (montado.current) {
      setCarga(resultado);
    }
  }

  /**
   * Tirar hacia abajo con la lista ya cargada.
   *
   * Si falla NO se sustituye la lista por una pantalla de error: lo que se
   * estaba leyendo sigue siendo válido, y perderlo por un fallo de red es peor
   * que no haber refrescado. Se avisa con una línea encima y ya.
   */
  async function refrescar() {
    setRefrescando(true);
    const resultado = await pedirHistorial();

    if (!montado.current) {
      return;
    }

    if (resultado.estado === 'error') {
      setFalloRefresco(true);
    } else {
      setCarga(resultado);
      setFalloRefresco(false);
    }
    setRefrescando(false);
  }

  if (carga.estado === 'cargando') {
    return (
      <View style={styles.centrado}>
        <ActivityIndicator />
        <Text style={styles.apagado}>Cargando…</Text>
      </View>
    );
  }

  if (carga.estado === 'error') {
    return (
      <View style={styles.centrado}>
        <Text style={styles.apagado}>{carga.mensaje}</Text>

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={reintentar}
        >
          <Text style={styles.buttonText}>Reintentar</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.buttonText}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  const { historial } = carga;

  return (
    <View style={styles.lista}>
      {/* Fuera de la FlatList, no en un ListHeaderComponent: así el aviso no se
          va con el scroll justo cuando el usuario está mirando otra parte. */}
      {falloRefresco && <Text style={styles.avisoRefresco}>No se pudo actualizar.</Text>}

      <FlatList
        style={styles.scroll}
        contentContainerStyle={styles.contenido}
        data={recientesPrimero}
        keyExtractor={(sesion) => sesion.recording_id}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
        renderItem={({ item }) => {
          const { texto, atenuado } = describirSesion(item);
          const cuando = formatearFechaHora(item.recorded_at);

          return (
            <Pressable
              style={({ pressed }) => [styles.fila, pressed && styles.filaPulsada]}
              onPress={() =>
                navigation.navigate('RecordingDetail', { recordingId: item.recording_id })
              }
              accessibilityRole="button"
              accessibilityLabel={`Grabación del ${cuando}. ${texto}.`}
            >
              <Text style={styles.cuando}>{cuando}</Text>
              <Text style={[styles.detalle, atenuado && styles.detalleApagado]}>{texto}</Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.tarjeta}>
            <Text style={styles.apagado}>
              Todavía no has grabado nada. Cuando grabes, tus sesiones aparecerán aquí.
            </Text>
          </View>
        }
        ListFooterComponent={
          historial.has_more && historial.total_sessions !== null ? (
            <Text style={styles.pie}>
              Mostrando las últimas {recientesPrimero.length} de {historial.total_sessions} sesiones.
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  lista: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scroll: {
    flex: 1,
  },
  contenido: {
    padding: 24,
    gap: 10,
  },
  centrado: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  fila: {
    backgroundColor: '#f4f4f5',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  filaPulsada: {
    opacity: 0.85,
  },
  cuando: {
    fontSize: 14,
    fontWeight: '500',
    color: '#18181b',
  },
  detalle: {
    fontSize: 13,
    color: '#3f3f46',
    // El texto de la derecha es el que cede si la fila no cabe.
    flexShrink: 1,
    textAlign: 'right',
  },
  // Las inválidas solo cambian el color del motivo; la fila entera se deja
  // igual de legible porque se puede abrir como cualquier otra.
  detalleApagado: {
    color: '#71717a',
  },
  tarjeta: {
    backgroundColor: '#f4f4f5',
    borderRadius: 8,
    padding: 16,
  },
  avisoRefresco: {
    fontSize: 13,
    color: '#71717a',
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  pie: {
    fontSize: 13,
    color: '#71717a',
    textAlign: 'center',
    // Separado de la última fila, que ya trae el gap del contenedor.
    marginTop: 6,
  },
  apagado: {
    fontSize: 14,
    lineHeight: 20,
    color: '#71717a',
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#e4e4e7',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    alignSelf: 'stretch',
  },
  buttonText: {
    color: '#18181b',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.85,
  },
});
