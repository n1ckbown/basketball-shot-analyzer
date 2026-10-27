import { CameraView, useCameraPermissions } from 'expo-camera';
import { Asset, usePermissions as useMediaPermissions } from 'expo-media-library';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function App() {
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
      return `Couldn't save video: ${error instanceof Error ? error.message : String(error)}`;
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
      setMessage(`Recording failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    setIsRecording(false);
    if (uri) {
      setMessage('Saving…');
      setMessage(await saveVideo(uri));
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
      <StatusBar style="light" />
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
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
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
    color: '#fff',
    fontSize: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  recordButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#e53935',
    borderWidth: 4,
    borderColor: '#fff',
  },
  recording: {
    borderRadius: 16,
  },
  disabled: {
    opacity: 0.4,
  },
});
