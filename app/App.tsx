import { CameraView, useCameraPermissions } from 'expo-camera';
import { File, UploadType } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Asset, usePermissions as useMediaPermissions } from 'expo-media-library';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const POLL_INTERVAL_MS = 3000;
const SETUP_TIP =
  'Prop your phone up in landscape, about 45° behind you on your shooting side, with the hoop near the top of the screen.';

type Results = { attempts: number; makes: number; shots: { time: number; made: boolean }[] };

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function clock(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export default function App() {
  const camera = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = useMediaPermissions({
    writeOnly: true,
    granularPermissions: ['video'],
  });
  const [isReady, setIsReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [message, setMessage] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [results, setResults] = useState<Results | null>(null);

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

  async function analyzeVideo(uri: string) {
    const server = process.env.EXPO_PUBLIC_SERVER_URL;
    if (!server) {
      setAnalysis('Not analyzed: no server address set (EXPO_PUBLIC_SERVER_URL).');
      return;
    }
    setIsAnalyzing(true);
    try {
      setAnalysis('Uploading… 0%');
      const upload = await new File(uri).upload(`${server}/videos`, {
        uploadType: UploadType.MULTIPART,
        // iPhones record .mov and Android phones .mp4; the server accepts only these two types.
        mimeType: uri.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/quicktime',
        onProgress: ({ bytesSent, totalBytes }) =>
          setAnalysis(`Uploading… ${Math.min(99, Math.floor((100 * bytesSent) / totalBytes))}%`),
      });
      if (upload.status !== 201) throw new Error(`upload failed (HTTP ${upload.status})`);
      const { job_id: jobId } = JSON.parse(upload.body);
      setAnalysis('Finding your shots… this takes about half as long as the video.');
      for (;;) {
        const job = await (await fetch(`${server}/videos/${jobId}`)).json();
        if (job.status === 'done') {
          setResults(job);
          setAnalysis('');
          return;
        }
        if (job.status === 'failed') throw new Error(job.error);
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (error) {
      setAnalysis(`Couldn't analyze: ${errorText(error)}`);
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function pickVideo() {
    setMessage('');
    setAnalysis('');
    let uri: string | undefined;
    try {
      // iOS hands over the original video file only with photo library read access.
      if (Platform.OS === 'ios' && !(await ImagePicker.requestMediaLibraryPermissionsAsync()).granted) {
        setMessage("Can't open videos: allow photo library access in Settings.");
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
      uri = picked.canceled ? undefined : picked.assets[0].uri;
    } catch (error) {
      setMessage(`Couldn't open video: ${errorText(error)}`);
    }
    if (uri) await analyzeVideo(uri);
  }

  async function startRecording() {
    setMessage('');
    setAnalysis('');
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
      setMessage(await saveVideo(uri));
      await analyzeVideo(uri);
    }
  }

  if (results) {
    const percent = results.attempts ? Math.round((100 * results.makes) / results.attempts) : 0;
    return (
      <View style={[styles.container, styles.results]}>
        <Text accessibilityRole="header" style={styles.heading}>
          {results.attempts ? `${results.makes} of ${results.attempts} made (${percent}%)` : 'No shots found'}
        </Text>
        <ScrollView contentContainerStyle={styles.shotList}>
          {results.shots.map((shot, index) => (
            <Text key={index} style={styles.text}>
              {`${clock(shot.time)}  ${shot.made ? 'Make' : 'Miss'}`}
            </Text>
          ))}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => {
            setResults(null);
            setIsReady(false); // The camera remounts and reports ready again.
          }}>
          <Text style={styles.buttonText}>Done</Text>
        </Pressable>
        <StatusBar style="light" />
      </View>
    );
  }

  const canRecord = isReady && !isAnalyzing;
  return (
    <View style={styles.container}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        mode="video"
        mute
        onCameraReady={() => setIsReady(true)}
      />
      {!isRecording && !message && !analysis ? <Text style={[styles.message, styles.tip]}>{SETUP_TIP}</Text> : null}
      <View style={styles.controls}>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {analysis ? <Text style={styles.message}>{analysis}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
          accessibilityState={{ disabled: !canRecord }}
          disabled={!canRecord}
          onPress={isRecording ? () => camera.current?.stopRecording() : startRecording}
          style={[styles.recordButton, isRecording && styles.recording, !canRecord && styles.disabled]}
        />
        {!isRecording ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isAnalyzing }}
            disabled={isAnalyzing}
            onPress={pickVideo}
            style={[styles.button, isAnalyzing && styles.disabled]}>
            <Text style={styles.buttonText}>Upload a video</Text>
          </Pressable>
        ) : null}
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
  results: {
    alignItems: 'center',
    paddingTop: 64,
    paddingBottom: 32,
    paddingHorizontal: 24,
    gap: 16,
  },
  heading: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  shotList: {
    gap: 8,
    alignItems: 'center',
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
  tip: {
    position: 'absolute',
    top: 48,
    left: 24,
    right: 24,
    textAlign: 'center',
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
