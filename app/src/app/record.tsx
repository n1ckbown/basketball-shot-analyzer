import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { Asset, usePermissions as useMediaPermissions } from 'expo-media-library';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { errorText } from '../analyze';
import { colors } from '../theme';

const SETUP_TIP =
  'Prop your phone up in landscape, about 45° behind you on your shooting side, with the hoop near the top of the screen.';

export default function Record() {
  const camera = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = useMediaPermissions({
    writeOnly: true,
    granularPermissions: ['video'],
  });
  const [isReady, setIsReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [message, setMessage] = useState('');

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

  return (
    <View style={styles.container}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        mode="video"
        mute
        onCameraReady={() => setIsReady(true)}
      />
      {!isRecording && !message ? <Text style={[styles.message, styles.tip]}>{SETUP_TIP}</Text> : null}
      {!isRecording ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.close} onPress={() => router.back()}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      ) : null}
      <View style={styles.controls}>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
          accessibilityState={{ disabled: !isReady }}
          disabled={!isReady}
          onPress={isRecording ? () => camera.current?.stopRecording() : startRecording}
          style={[styles.recordButton, isRecording && styles.recording, !isReady && styles.disabled]}
        />
      </View>
    </View>
  );
}

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
  tip: {
    position: 'absolute',
    top: 48,
    left: 76,
    right: 24,
    textAlign: 'center',
  },
  close: {
    position: 'absolute',
    top: 44,
    left: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(14, 15, 17, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: colors.text,
    fontSize: 18,
  },
  controls: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 12,
  },
  message: {
    color: colors.text,
    fontSize: 15,
    backgroundColor: 'rgba(14, 15, 17, 0.75)',
    borderRadius: 999,
    overflow: 'hidden',
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  recordButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#FF453A',
    borderWidth: 4,
    borderColor: colors.text,
  },
  recording: {
    borderRadius: 18,
  },
  disabled: {
    opacity: 0.4,
  },
});
