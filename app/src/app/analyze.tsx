import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { analyzeVideo, errorText, type Progress } from '../analyze';
import { Ring } from '../components/Ring';
import { StepIcon } from '../components/StepIcon';
import { type Mode, saveSession } from '../sessions';
import { colors } from '../theme';

const STEPS = [
  { step: 'upload', label: 'Upload video' },
  { step: 'analysis', label: 'Find your shots' },
] as const;

export default function Analyze() {
  const insets = useSafeAreaInsets();
  // note: how saving the recording to the photo library went, passed on by the record screen.
  const { uri, note, mode = 'shots' } = useLocalSearchParams<{ uri: string; note?: string; mode?: Mode }>();
  const [progress, setProgress] = useState<Progress>({ step: 'upload', fraction: 0 });
  const [timeLeft, setTimeLeft] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // Leaving this screen cancels the upload and stops checking on the server.
    const controller = new AbortController();
    let analysisStart = 0;
    function onProgress(next: Progress) {
      setProgress(next);
      if (next.step !== 'analysis') return;
      analysisStart ||= Date.now();
      // Wait for a few percent before projecting, so the first guess isn't wild.
      if (next.fraction >= 0.05) {
        const minutes = ((Date.now() - analysisStart) * (1 - next.fraction)) / next.fraction / 60000;
        setTimeLeft(minutes < 1 ? 'Less than a minute left' : `About ${Math.round(minutes)} min left`);
      }
    }
    analyzeVideo(uri, mode, onProgress, controller.signal)
      .then(saveSession)
      .then((session) => router.replace(`/results/${session.id}`))
      .catch((reason) => controller.signal.aborted || setError(errorText(reason)));
    return () => controller.abort();
  }, [uri, mode]);

  const percent = Math.floor(100 * progress.fraction);
  const headline = progress.step === 'upload' ? 'Uploading' : 'Finding your shots';
  const current = STEPS.findIndex(({ step }) => step === progress.step);
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}>
      <Pressable accessibilityRole="button" style={styles.cancel} onPress={() => router.back()}>
        <Text style={styles.cancelText}>{error ? 'Back' : 'Cancel'}</Text>
      </Pressable>

      {error ? (
        <View style={styles.body}>
          <Text accessibilityRole="header" style={styles.title}>
            Couldn&apos;t analyze
          </Text>
          <Text style={styles.status}>{error}</Text>
          {note ? <Text style={styles.note}>{note}</Text> : null}
        </View>
      ) : (
        <>
          <View style={styles.body}>
            <View accessible accessibilityRole="image" accessibilityLabel={`${headline}: ${percent}%`} style={styles.ring}>
              <Ring size={220} stroke={16} fraction={progress.fraction} />
              <Text style={styles.percent}>{percent}%</Text>
            </View>
            <Text accessibilityRole="header" style={styles.title}>
              {headline}
            </Text>
            <Text style={styles.status}>
              {progress.step === 'upload'
                ? 'Sending your video to the server'
                : timeLeft ||
                  // Form checks also run the body-pose model, so they take about twice as long.
                  `This takes about ${mode === 'form' ? 'as long as' : 'half as long as'} the video.`}
            </Text>
            <View style={styles.steps}>
              {STEPS.map(({ step, label }, index) => (
                <View key={step} style={[styles.stepRow, index > 0 && styles.stepDivider]}>
                  <StepIcon state={index < current ? 'done' : index === current ? 'active' : 'waiting'} />
                  <Text style={[styles.stepLabel, index > current && styles.waitingLabel]}>{label}</Text>
                </View>
              ))}
            </View>
            {note ? <Text style={styles.note}>{note}</Text> : null}
          </View>
          <Text style={styles.note}>Keep the app open until your results are ready.</Text>
        </>
      )}
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
    gap: 12,
  },
  ring: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  percent: {
    position: 'absolute',
    color: colors.text,
    fontSize: 48,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
  status: {
    color: colors.secondary,
    fontSize: 15,
    textAlign: 'center',
  },
  steps: {
    alignSelf: 'stretch',
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 4,
    borderRadius: 18,
    backgroundColor: colors.card,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  stepDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  stepLabel: {
    color: colors.text,
    fontSize: 16,
  },
  waitingLabel: {
    color: colors.tertiary,
  },
  note: {
    color: colors.tertiary,
    fontSize: 14,
    textAlign: 'center',
  },
});
