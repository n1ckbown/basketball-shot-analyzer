import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { launchImageLibraryAsync, requestMediaLibraryPermissionsAsync } from 'expo-image-picker';
import { Asset, usePermissions } from 'expo-media-library';
import { renderRouter } from 'expo-router/testing-library';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

jest.mock('expo-camera', () => {
  // jest.mock factories are hoisted above imports, so they must require().
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEffect, useImperativeHandle } = require('react');
  let finishRecording: (video: { uri: string }) => void;
  const shown = { facing: '' };
  return {
    useCameraPermissions: jest.fn(),
    shown,
    // Fake camera: ready on mount, recordAsync resolves when stopRecording is called, photos are instant.
    CameraView: ({ ref, onCameraReady, facing }: { ref: unknown; onCameraReady?: () => void; facing: string }) => {
      shown.facing = facing;
      useImperativeHandle(ref, () => ({
        recordAsync: () => new Promise((resolve) => (finishRecording = resolve)),
        stopRecording: () => finishRecording({ uri: 'file:///cache/session.mov' }),
        takePictureAsync: async () => ({ uri: 'file:///cache/photo.jpg' }),
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

// In-memory files, so saved sessions persist within a test.
jest.mock('expo-file-system', () => {
  const files = new Map<string, string>();
  const upload = jest.fn();
  class MockFile {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    get exists() {
      return files.has(this.uri);
    }
    create() {
      files.set(this.uri, '');
    }
    async text() {
      return files.get(this.uri);
    }
    async write(content: string) {
      files.set(this.uri, content);
    }
    delete() {
      files.delete(this.uri);
    }
    upload(...args: unknown[]) {
      return upload(...args);
    }
  }
  return {
    File: jest.fn((...parts) => new MockFile(...parts)),
    Paths: { document: { uri: 'file:///documents' } },
    UploadType: { MULTIPART: 1 },
    files,
    upload,
  };
});

const SERVER = 'http://192.168.1.20:8000';
const DONE = {
  status: 'done',
  attempts: 3,
  makes: 2,
  duration: 95.2,
  shots: [
    { time: 18.1, made: true },
    { time: 28.0, made: false },
    { time: 70.4, made: true },
  ],
};
const APP = './src/app';
const SETUP_OK = { hoop: true, room_above: true, close_enough: true };
// Answers to the camera's setup checks, in order; the last one repeats.
let setupAnswers: object[] = [SETUP_OK];

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
  upload.mockImplementation(async (url: string, { onProgress }: { onProgress: (p: object) => void }) => {
    if (url.endsWith('/setup-check')) {
      const answer = setupAnswers.length > 1 ? setupAnswers.shift() : setupAnswers[0];
      return { status: 200, body: JSON.stringify(answer), headers: {} };
    }
    onProgress({ bytesSent: BigInt(50), totalBytes: BigInt(100) }); // the phone reports BigInt, not number
    return { status: 201, body: JSON.stringify({ job_id: 'abc123' }), headers: {} };
  });
  const fetchMock = jest.fn();
  for (const state of jobStates) fetchMock.mockResolvedValueOnce({ json: async () => state });
  globalThis.fetch = fetchMock;
  return { upload, fetchMock };
}

function mockPickedVideo(granted: boolean, picked: object) {
  jest.mocked(requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted } as never);
  jest.mocked(launchImageLibraryAsync).mockResolvedValue(picked as never);
}

function savedSessions() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const json = require('expo-file-system').files.get('file:///documents/sessions.json');
  return json ? JSON.parse(json) : [];
}

async function recordOneSession(user = userEvent.setup()) {
  await renderRouter(APP);
  await user.press(screen.getByRole('button', { name: 'Start a session' }));
  await user.press(await screen.findByRole('button', { name: 'Start recording' }));
  await user.press(await screen.findByRole('button', { name: 'Stop recording' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('expo-file-system').files.clear();
  setupAnswers = [SETUP_OK];
  process.env.EXPO_PUBLIC_SERVER_URL = SERVER;
});

test('home invites a first session when nothing is saved yet', async () => {
  await renderRouter(APP);

  expect(screen.getByText('No sessions yet')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Start a session' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Upload a video' })).toBeTruthy();
});

test('asks for camera access before showing the camera', async () => {
  const requestCamera = mockPermissions(false, false);
  await renderRouter(APP, { initialUrl: '/record' });

  await userEvent.setup().press(screen.getByRole('button', { name: 'Allow camera' }));

  expect(requestCamera).toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull();
});

// Real timers: the app waits one 3-second poll before the result arrives (fake timers hung this test).
test('records, saves, analyzes and shows the session results', async () => {
  mockPermissions(true, true);
  const { upload, fetchMock } = mockServer({ status: 'processing' }, DONE);
  await recordOneSession();

  expect(Asset.create).toHaveBeenCalledWith('file:///cache/session.mov');
  expect(File).toHaveBeenCalledWith('file:///cache/session.mov');
  expect(upload).toHaveBeenCalledWith(
    `${SERVER}/videos`,
    expect.objectContaining({ fieldName: 'file', mimeType: 'video/quicktime' }),
  );
  expect(await screen.findByText('Saved to your photo library.')).toBeTruthy();

  expect(await screen.findByRole('image', { name: '67% made, 2 of 3' }, { timeout: 5000 })).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith(`${SERVER}/videos/abc123`, expect.anything());
  expect(screen.getByText('1:35 session')).toBeTruthy();
  expect(screen.getByRole('image', { name: 'Makes at 0:18, 1:10' })).toBeTruthy();
  expect(screen.getByText('0:28')).toBeTruthy();
  expect(savedSessions()).toEqual([expect.objectContaining({ attempts: 3, makes: 2, duration: 95.2 })]);
}, 15000);

test('done on the results returns home, which lists the saved session', async () => {
  mockPermissions(true, true);
  mockServer(DONE);
  const user = userEvent.setup();
  await recordOneSession(user);
  await screen.findByRole('image', { name: '67% made, 2 of 3' });

  await user.press(screen.getByRole('button', { name: 'Done' }));

  expect(await screen.findByRole('button', { name: 'Latest session: 67%, 2 of 3 made' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Today: 2 of 3 made, 67%' })).toBeTruthy();
});

test('tells the user when photo library access is denied', async () => {
  mockPermissions(true, false);
  mockServer({ status: 'failed', error: 'stop here' });
  await recordOneSession();

  expect(await screen.findByText('Not saved: allow photo library access in Settings.')).toBeTruthy();
  expect(Asset.create).not.toHaveBeenCalled();
});

test('reports a failed analysis without saving a session', async () => {
  mockPermissions(true, true);
  mockServer({ status: 'failed', error: 'Could not open video' });
  await recordOneSession();

  expect(await screen.findByText('Could not open video')).toBeTruthy();
  expect(screen.getByRole('header', { name: "Couldn't analyze" })).toBeTruthy();
  expect(savedSessions()).toEqual([]);
});

test('explains when no server address is set', async () => {
  mockPermissions(true, true);
  const { upload } = mockServer();
  delete process.env.EXPO_PUBLIC_SERVER_URL;
  await recordOneSession();

  expect(await screen.findByRole('header', { name: "Couldn't analyze" })).toBeTruthy();
  expect(screen.getByText(/no server address set/)).toBeTruthy();
  expect(upload).not.toHaveBeenCalled();
});

test('uploads a video picked from the library and shows its results', async () => {
  mockPickedVideo(true, { canceled: false, assets: [{ uri: 'file:///cache/old-session.mp4' }] });
  const { upload } = mockServer(DONE);
  await renderRouter(APP);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Upload a video' }));

  expect(launchImageLibraryAsync).toHaveBeenCalledWith({ mediaTypes: ['videos'] });
  expect(await screen.findByRole('image', { name: '67% made, 2 of 3' })).toBeTruthy();
  expect(File).toHaveBeenCalledWith('file:///cache/old-session.mp4');
  expect(upload).toHaveBeenCalledWith(`${SERVER}/videos`, expect.objectContaining({ mimeType: 'video/mp4' }));
  expect(Asset.create).not.toHaveBeenCalled();
});

test('does nothing when the user cancels the video picker', async () => {
  mockPickedVideo(true, { canceled: true, assets: null });
  const { upload } = mockServer();
  await renderRouter(APP);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Upload a video' }));

  expect(launchImageLibraryAsync).toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
  expect(screen).toHavePathname('/');
});

test('explains when photo library access is denied for picking a video', async () => {
  mockPickedVideo(false, { canceled: true, assets: null });
  await renderRouter(APP);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Upload a video' }));

  expect(await screen.findByText("Can't open videos: allow photo library access in Settings.")).toBeTruthy();
  expect(launchImageLibraryAsync).not.toHaveBeenCalled();
});

test('the setup panel says what to fix', async () => {
  mockPermissions(true, true);
  mockServer();
  setupAnswers = [{ hoop: true, room_above: false, close_enough: true }];
  await renderRouter(APP, { initialUrl: '/record' });

  expect(await screen.findByText("Tilt the phone down a little so there's space above the rim.")).toBeTruthy();
  expect(screen.getByRole('header', { name: 'Set up your shot' })).toBeTruthy();
  expect(screen.getByLabelText('Hoop in view: yes')).toBeTruthy();
  expect(screen.getByLabelText('Room above the rim: not yet')).toBeTruthy();
});

// Real timers: the second check comes 3 seconds after the first.
test('a photo that cannot judge the rim keeps the last clear answer', async () => {
  mockPermissions(true, true);
  const { upload } = mockServer();
  setupAnswers = [SETUP_OK, { hoop: true, room_above: null, close_enough: null }];
  await renderRouter(APP, { initialUrl: '/record' });
  expect(await screen.findByRole('header', { name: 'Ready to record' })).toBeTruthy();

  await waitFor(() => expect(upload).toHaveBeenCalledTimes(2), { timeout: 5000 });

  expect(screen.getByRole('header', { name: 'Ready to record' })).toBeTruthy();
  expect(screen.getByLabelText('Room above the rim: yes')).toBeTruthy();
}, 15000);

test('flips to the front camera before recording, not during', async () => {
  mockPermissions(true, true);
  mockServer();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { shown } = require('expo-camera');
  const user = userEvent.setup();
  await renderRouter(APP, { initialUrl: '/record' });
  expect(shown.facing).toBe('back');

  await user.press(screen.getByRole('button', { name: 'Switch to front camera' }));
  expect(shown.facing).toBe('front');
  await user.press(screen.getByRole('button', { name: 'Start recording' }));

  expect(await screen.findByRole('button', { name: 'Stop recording' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Switch to back camera' })).toBeNull();
});
