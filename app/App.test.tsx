import { render, screen, userEvent } from '@testing-library/react-native';
import { useCameraPermissions } from 'expo-camera';
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
        stopRecording: () => finishRecording({ uri: 'file:///cache/session.mp4' }),
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

function mockPermissions(camera: boolean, media: boolean) {
  const requestCamera = jest.fn();
  jest.mocked(useCameraPermissions).mockReturnValue([{ granted: camera }, requestCamera] as never);
  jest
    .mocked(usePermissions)
    .mockReturnValue([{ granted: media }, jest.fn().mockResolvedValue({ granted: media })] as never);
  return requestCamera;
}

async function recordOneSession() {
  const user = userEvent.setup();
  await render(<App />);
  await user.press(screen.getByRole('button', { name: 'Start recording' }));
  await user.press(await screen.findByRole('button', { name: 'Stop recording' }));
}

beforeEach(() => jest.clearAllMocks());

test('asks for camera access before showing the camera', async () => {
  const requestCamera = mockPermissions(false, false);
  await render(<App />);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Allow camera' }));

  expect(requestCamera).toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull();
});

test('saves the recorded video to the photo library', async () => {
  mockPermissions(true, true);
  await recordOneSession();

  expect(await screen.findByText('Saved to your photo library.')).toBeTruthy();
  expect(Asset.create).toHaveBeenCalledWith('file:///cache/session.mp4');
});

test('tells the user when photo library access is denied', async () => {
  mockPermissions(true, false);
  await recordOneSession();

  expect(await screen.findByText('Not saved: allow photo library access in Settings.')).toBeTruthy();
  expect(Asset.create).not.toHaveBeenCalled();
});
