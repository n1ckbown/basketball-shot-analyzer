import { render, screen, userEvent } from '@testing-library/react-native';
import { useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { launchImageLibraryAsync, requestMediaLibraryPermissionsAsync } from 'expo-image-picker';
import { Asset, usePermissions } from 'expo-media-library';

import App from './App';

jest.mock('expo-camera', () => {
  // jest.mock factories are hoisted above imports, so they must require().
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEffect, useImperativeHandle } = require('react');
  let finishRecording: (video: { uri: string }) => void;
  return {
    useCameraPermissions: jest.fn(),
    // Fake camera: ready on mount, and recordAsync resolves when stopRecording is called.
    CameraView: ({ ref, onCameraReady }: { ref: unknown; onCameraReady?: () => void }) => {
      useImperativeHandle(ref, () => ({
        recordAsync: () => new Promise((resolve) => (finishRecording = resolve)),
        stopRecording: () => finishRecording({ uri: 'file:///cache/session.mov' }),
      }));
      useEffect(() => onCameraReady?.(), [onCameraReady]);
      return null;
    },
  };
});

jest.mock('expo-media-library', () => ({
  Asset: { create: jest.fn() },
  usePermissions: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('expo-file-system', () => {
  const upload = jest.fn();
  return { File: jest.fn(() => ({ upload })), UploadType: { MULTIPART: 1 }, upload };
});

const SERVER = 'http://192.168.1.20:8000';
const DONE = {
  status: 'done',
  attempts: 3,
  makes: 2,
  shots: [
    { time: 18.1, made: true },
    { time: 28.0, made: false },
    { time: 70.4, made: true },
  ],
};

function mockPermissions(camera: boolean, media: boolean) {
  const requestCamera = jest.fn();
  jest.mocked(useCameraPermissions).mockReturnValue([{ granted: camera }, requestCamera] as never);
  jest
    .mocked(usePermissions)
    .mockReturnValue([{ granted: media }, jest.fn().mockResolvedValue({ granted: media })] as never);
  return requestCamera;
}

function mockServer(...jobStates: object[]) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { upload } = require('expo-file-system');
  upload.mockResolvedValue({ status: 201, body: JSON.stringify({ job_id: 'abc123' }), headers: {} });
  const fetchMock = jest.fn();
  for (const state of jobStates) fetchMock.mockResolvedValueOnce({ json: async () => state });
  globalThis.fetch = fetchMock;
  return { upload, fetchMock };
}

async function recordOneSession(user = userEvent.setup()) {
  await render(<App />);
  await user.press(screen.getByRole('button', { name: 'Start recording' }));
  await user.press(await screen.findByRole('button', { name: 'Stop recording' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_SERVER_URL = SERVER;
});

test('asks for camera access before showing the camera', async () => {
  const requestCamera = mockPermissions(false, false);
  await render(<App />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Allow camera' }));

  expect(requestCamera).toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull();
});

test('saves the recorded video to the photo library', async () => {
  mockPermissions(true, true);
  mockServer({ status: 'failed', error: 'stop here' });
  await recordOneSession();

  expect(await screen.findByText('Saved to your photo library.')).toBeTruthy();
  expect(Asset.create).toHaveBeenCalledWith('file:///cache/session.mov');
});

test('tells the user when photo library access is denied', async () => {
  mockPermissions(true, false);
  mockServer({ status: 'failed', error: 'stop here' });
  await recordOneSession();

  expect(await screen.findByText('Not saved: allow photo library access in Settings.')).toBeTruthy();
  expect(Asset.create).not.toHaveBeenCalled();
});

// Real timers: the app waits one 3-second poll before the result arrives (fake timers hung this test).
test('uploads the session, waits for analysis and shows makes and misses', async () => {
  mockPermissions(true, true);
  const { upload, fetchMock } = mockServer({ status: 'processing' }, DONE);
  await recordOneSession();

  expect(File).toHaveBeenCalledWith('file:///cache/session.mov');
  expect(upload).toHaveBeenCalledWith(`${SERVER}/videos`, expect.objectContaining({ mimeType: 'video/quicktime' }));
  expect(await screen.findByText(/Finding your shots/)).toBeTruthy();

  expect(await screen.findByRole('header', { name: '2 of 3 made (67%)' }, { timeout: 5000 })).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith(`${SERVER}/videos/abc123`);
  expect(screen.getByText('0:18  Make')).toBeTruthy();
  expect(screen.getByText('0:28  Miss')).toBeTruthy();
  expect(screen.getByText('1:10  Make')).toBeTruthy();
}, 15000);

test('reports a failed analysis and lets the user record again', async () => {
  mockPermissions(true, true);
  mockServer({ status: 'failed', error: 'Could not open video' });
  await recordOneSession();

  expect(await screen.findByText("Couldn't analyze: Could not open video")).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Start recording' })).toBeEnabled();
});

function mockPickedVideo(granted: boolean, picked: object) {
  jest.mocked(requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted } as never);
  jest.mocked(launchImageLibraryAsync).mockResolvedValue(picked as never);
}

test('uploads a video picked from the library and shows makes and misses', async () => {
  mockPermissions(true, true);
  mockPickedVideo(true, { canceled: false, assets: [{ uri: 'file:///cache/old-session.mp4' }] });
  const { upload } = mockServer(DONE);
  await render(<App />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Upload a video' }));

  expect(launchImageLibraryAsync).toHaveBeenCalledWith({ mediaTypes: ['videos'] });
  expect(File).toHaveBeenCalledWith('file:///cache/old-session.mp4');
  expect(upload).toHaveBeenCalledWith(`${SERVER}/videos`, expect.objectContaining({ mimeType: 'video/mp4' }));
  expect(await screen.findByRole('header', { name: '2 of 3 made (67%)' })).toBeTruthy();
  expect(Asset.create).not.toHaveBeenCalled();
});

test('does nothing when the user cancels the video picker', async () => {
  mockPermissions(true, true);
  mockPickedVideo(true, { canceled: true, assets: null });
  const { upload } = mockServer();
  await render(<App />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Upload a video' }));

  expect(launchImageLibraryAsync).toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
});

test('explains when photo library access is denied for picking a video', async () => {
  mockPermissions(true, true);
  mockPickedVideo(false, { canceled: true, assets: null });
  await render(<App />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Upload a video' }));

  expect(await screen.findByText("Can't open videos: allow photo library access in Settings.")).toBeTruthy();
  expect(launchImageLibraryAsync).not.toHaveBeenCalled();
});

test('explains when no server address is set', async () => {
  mockPermissions(true, true);
  const { upload } = mockServer();
  delete process.env.EXPO_PUBLIC_SERVER_URL;
  await recordOneSession();

  expect(await screen.findByText(/no server address set/)).toBeTruthy();
  expect(upload).not.toHaveBeenCalled();
});
