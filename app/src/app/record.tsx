import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { Asset, usePermissions as useMediaPermissions } from 'expo-media-library';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { checkSetup, errorText, type SetupChecks } from '../analyze';
import { StepIcon } from '../components/StepIcon';
import { clock } from '../sessions';
import { colors } from '../theme';

const CHECK_INTERVAL_MS = 3000;
const CHECKS = [
  { key: 'hoop', label: 'Hoop in view', fix: 'Point the camera at the hoop.' },
  { key: 'room_above', label: 'Room above the rim', fix: "Tilt the phone down a little so there's space above the rim." },
  { key: 'close_enough', label: 'Close enough to the hoop', fix: 'Move closer to the hoop.' },
] as const;

export default function Record() {
  const camera = useRef<CameraView>(null);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = useMediaPermissions({
    writeOnly: true,
    granularPermissions: ['video'],
  });
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [isReady, setIsReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [checks, setChecks] = useState<SetupChecks | null>(null);
  const [checkError, setCheckError] = useState('');
  const [message, setMessage] = useState('');

  // Before recording, check a quiet photo every few seconds so the panel follows the phone as it's adjusted.
  useEffect(() => {
    if (!isReady || isRecording) return;
    let busy = false;
    async function check() {
      if (busy) return;
      busy = true;
      try {
        const photo = await camera.current?.takePictureAsync({ quality: 0.3, shutterSound: false });
        if (!photo) return;
        const result = await checkSetup(photo.uri).finally(() => new File(photo.uri).delete());
        // A photo that can't judge the rim keeps the last clear answer.
        setChecks((previous) => ({
          hoop: result.hoop,
          room_above: result.room_above ?? previous?.room_above ?? null,
          close_enough: result.close_enough ?? previous?.close_enough ?? null,
        }));
        setCheckError('');
      } catch (error) {
        setCheckError(`Setup check unavailable: ${errorText(error)}`);
      } finally {
        busy = false;
      }
    }
    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isReady, isRecording, facing]);

  useEffect(() => {
    if (!isRecording) return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [isRecording]);

  if (!cameraPermission) return <View style={styles.container} />;

  if (!cameraPermission.granted) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.text}>Camera access is needed to record your shots.</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={requestCameraPermission}>
          <Text style={styles.buttonText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  async function saveVideo(uri: string) {
    try {
      const permission = mediaPermission?.granted ? mediaPermission : await requestMediaPermission();
      if (!permission.granted) return 'Not saved: allow photo library access in Settings.';
      await Asset.create(uri);
      return 'Saved to your photo library.';
    } catch (error) {
      return `Couldn't save video: ${errorText(error)}`;
    }
  }

  async function startRecording() {
    setMessage('');
    setSeconds(0);
    setIsRecording(true);
    let uri: string | undefined;
    try {
      // Resolves only once stopRecording() is called.
      uri = (await camera.current?.recordAsync())?.uri;
    } catch (error) {
      setMessage(`Recording failed: ${errorText(error)}`);
    }
    setIsRecording(false);
    if (uri) {
      setMessage('Saving…');
      const note = await saveVideo(uri);
      router.replace({ pathname: '/analyze', params: { uri, note } });
    }
  }

  function flip() {
    setFacing(facing === 'back' ? 'front' : 'back');
    setChecks(null);
  }

  const landscape = width > height;
  const ready = checks !== null && CHECKS.every(({ key }) => checks[key]);
  const fix = checks && CHECKS.find(({ key }) => checks[key] === false)?.fix;
  return (
    <View style={styles.container}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        mode="video"
        facing={facing}
        mute
        onCameraReady={() => setIsReady(true)}
      />

      {isRecording ? (
        <View style={[styles.pill, styles.timer, { top: insets.top + 12 }]}>
          <View style={styles.recordingDot} />
          <Text style={styles.timerText}>{clock(seconds)}</Text>
        </View>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={[styles.roundButton, { top: insets.top + 8, left: insets.left + 16 }]}
            onPress={() => router.back()}>
            <Svg width={14} height={14} viewBox="0 0 14 14">
              <Path d="M2 2l10 10M12 2L2 12" stroke={colors.text} strokeWidth={2} strokeLinecap="round" />
            </Svg>
          </Pressable>
          {!message ? (
            <View
              style={[
                styles.panel,
                landscape
                  ? { top: insets.top + 16, right: insets.right + 16, width: 290 }
                  : { top: insets.top + 64, left: 16, right: 16 },
              ]}>
              <Text accessibilityRole="header" style={styles.panelTitle}>
                {checks === null ? 'Checking your setup…' : ready ? 'Ready to record' : 'Set up your shot'}
              </Text>
              {CHECKS.map(({ key, label }) => {
                const ok = checks?.[key];
                return (
                  <View
                    key={key}
                    accessible
                    accessibilityLabel={`${label}: ${ok ? 'yes' : ok === false ? 'not yet' : 'checking'}`}
                    style={styles.checkRow}>
                    <StepIcon state={ok ? 'done' : 'waiting'} />
                    <Text style={styles.checkLabel}>{label}</Text>
                  </View>
                );
              })}
              {fix || checkError ? <Text style={styles.fix}>{fix || checkError}</Text> : null}
              <Text style={styles.hint}>Best spot: propped up about 45° behind you, on your shooting side.</Text>
            </View>
          ) : null}
        </>
      )}

      <View style={[styles.controls, { bottom: insets.bottom + 24 }]}>
        {message ? <Text style={[styles.pill, styles.message]}>{message}</Text> : null}
        <View style={styles.controlRow}>
          <View style={styles.roundSpacer} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
            accessibilityState={{ disabled: !isReady }}
            disabled={!isReady}
            onPress={isRecording ? () => camera.current?.stopRecording() : startRecording}
            style={[styles.recordButton, !isReady && styles.disabled]}>
            <View style={isRecording ? styles.stopSquare : styles.recordDot} />
          </Pressable>
          {/* Flipping during a recording stops it, so the switch is only offered before. */}
          {isRecording ? (
            <View style={styles.roundSpacer} />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={facing === 'back' ? 'Switch to front camera' : 'Switch to back camera'}
              style={styles.flipButton}
              onPress={flip}>
              <Svg width={24} height={24} viewBox="0 0 24 24">
                <Path
                  d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z M9 12.5a3 3 0 0 1 5.2-2M15 12.5a3 3 0 0 1-5.2 2M14.2 8.6v1.9h-1.9M9.8 16.4v-1.9h1.9"
                  stroke={colors.text}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const ROUND = 44;
const OVERLAY = 'rgba(14, 15, 17, 0.75)';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  text: {
    color: colors.text,
    fontSize: 16,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  buttonText: {
    color: colors.onAccent,
    fontSize: 17,
    fontWeight: '600',
  },
  roundButton: {
    position: 'absolute',
    width: ROUND,
    height: ROUND,
    borderRadius: ROUND / 2,
    backgroundColor: OVERLAY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    position: 'absolute',
    padding: 18,
    borderRadius: 22,
    backgroundColor: 'rgba(14, 15, 17, 0.9)',
    gap: 12,
  },
  panelTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkLabel: {
    color: colors.text,
    fontSize: 15,
  },
  fix: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  hint: {
    color: colors.secondary,
    fontSize: 13,
    lineHeight: 18,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: OVERLAY,
    borderRadius: 999,
    overflow: 'hidden',
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  timer: {
    position: 'absolute',
    alignSelf: 'center',
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF453A',
  },
  timerText: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  message: {
    color: colors.text,
    fontSize: 15,
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 12,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 40,
  },
  roundSpacer: {
    width: ROUND,
  },
  flipButton: {
    width: ROUND,
    height: ROUND,
    borderRadius: ROUND / 2,
    backgroundColor: OVERLAY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordDot: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FF453A',
  },
  stopSquare: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#FF453A',
  },
  disabled: {
    opacity: 0.4,
  },
});
