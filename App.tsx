import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getHealth } from './src/services/api';

/**
 * PANTALLA TEMPORAL — solo verifica la conexión con el backend end-to-end.
 * Sustituir por la pantalla real cuando la conexión esté confirmada.
 */

type Status =
  | { state: 'loading' }
  | { state: 'ok'; data: unknown }
  | { state: 'error'; message: string };

export default function App() {
  const [status, setStatus] = useState<Status>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;

    getHealth()
      .then((data) => {
        if (!cancelled) setStatus({ state: 'ok', data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus({
            state: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Conexión con el backend</Text>
        <Text style={styles.url}>{process.env.EXPO_PUBLIC_API_URL ?? '(sin EXPO_PUBLIC_API_URL)'}</Text>

        {status.state === 'loading' && (
          <View style={styles.row}>
            <ActivityIndicator />
            <Text style={styles.pending}>Llamando a /health…</Text>
          </View>
        )}

        {status.state === 'ok' && (
          <>
            <Text style={styles.ok}>✓ Backend accesible</Text>
            <Text style={styles.json}>{JSON.stringify(status.data, null, 2)}</Text>
          </>
        )}

        {status.state === 'error' && (
          <>
            <Text style={styles.error}>✗ Sin conexión</Text>
            <Text style={styles.json}>{status.message}</Text>
          </>
        )}
      </ScrollView>
      <StatusBar style="auto" />
    </View>
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
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  url: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pending: {
    color: '#666',
  },
  ok: {
    fontSize: 16,
    fontWeight: '600',
    color: '#15803d',
    textAlign: 'center',
  },
  error: {
    fontSize: 16,
    fontWeight: '600',
    color: '#b91c1c',
    textAlign: 'center',
  },
  json: {
    fontFamily: 'monospace',
    fontSize: 13,
    backgroundColor: '#f4f4f5',
    borderRadius: 8,
    padding: 12,
    color: '#18181b',
  },
});