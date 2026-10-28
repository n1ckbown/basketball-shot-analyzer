import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { analyzeVideo, errorText } from '../analyze';
import { saveSession } from '../sessions';
import { colors } from '../theme';

export default function Analyze() {
  const insets = useSafeAreaInsets();
  // note: how saving the recording to the photo library went, passed on by the record screen.
  const { uri, note } = useLocalSearchParams<{ uri: string; note?: string }>();
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // Leaving this screen cancels the upload and stops checking on the server.
    const controller = new AbortController();
    analyzeVideo(uri, setStatus, controller.signal)
      .then(saveSession)
      .then((session) => router.replace(`/results/${session.id}`))
      .catch((reason) => controller.signal.aborted || setError(errorText(reason)));
    return () => controller.abort();
  }, [uri]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}>
      <Pressable accessibilityRole="button" style={styles.cancel} onPress={() => router.back()}>
        <Text style={styles.cancelText}>{error ? 'Back' : 'Cancel'}</Text>
      </Pressable>
      <View style={styles.body}>
        <Text accessibilityRole="header" style={styles.title}>
          {error ? "Couldn't analyze" : 'Analyzing'}
        </Text>
        <Text style={styles.status}>{error || status}</Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
      {error ? null : <Text style={styles.note}>Keep the app open until your results are ready.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 20,
  },
  cancel: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
  },
  cancelText: {
    color: colors.accent,
    fontSize: 17,
    fontWeight: '500',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
  status: {
    color: colors.secondary,
    fontSize: 16,
    textAlign: 'center',
  },
  note: {
    color: colors.tertiary,
    fontSize: 14,
    textAlign: 'center',
  },
});
