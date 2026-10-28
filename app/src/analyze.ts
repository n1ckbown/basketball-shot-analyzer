import { File, UploadType } from 'expo-file-system';

import type { Mode, Results } from './sessions';

const POLL_INTERVAL_MS = 3000;

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** null: the hoop is in view but this photo didn't show the rim clearly enough to judge. */
export type SetupChecks = { hoop: boolean; room_above: boolean | null; close_enough: boolean | null };

/** Asks the server whether a photo from the camera is framed well for tracking shots. */
export async function checkSetup(photoUri: string): Promise<SetupChecks> {
  const server = process.env.EXPO_PUBLIC_SERVER_URL;
  if (!server) throw new Error('no server address set (EXPO_PUBLIC_SERVER_URL).');
  const response = await new File(photoUri).upload(`${server}/setup-check`, {
    uploadType: UploadType.MULTIPART,
    fieldName: 'file',
    mimeType: 'image/jpeg',
  });
  if (response.status !== 200) throw new Error(`setup check failed (HTTP ${response.status})`);
  return JSON.parse(response.body);
}

/** Which step a video is on, and how far through it (0 to 1). */
export type Progress = { step: 'upload' | 'analysis'; fraction: number };

/** Uploads a video to the analysis server and waits for its makes and misses, or its form. */
export async function analyzeVideo(
  uri: string,
  mode: Mode,
  onProgress: (progress: Progress) => void,
  signal: AbortSignal,
): Promise<Results> {
  const server = process.env.EXPO_PUBLIC_SERVER_URL;
  if (!server) throw new Error('no server address set (EXPO_PUBLIC_SERVER_URL).');
  onProgress({ step: 'upload', fraction: 0 });
  const upload = await new File(uri).upload(`${server}/videos`, {
    uploadType: UploadType.MULTIPART,
    fieldName: 'file', // The server reads this field; the native default is the file name, not 'file' as documented.
    // iPhones record .mov and Android phones .mp4; the server accepts only these two types.
    mimeType: uri.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/quicktime',
    parameters: { mode },
    // On the phone these arrive as BigInt despite the number type, and BigInt can't mix with numbers.
    onProgress: ({ bytesSent, totalBytes }) =>
      onProgress({ step: 'upload', fraction: Math.min(0.99, Number(bytesSent) / Number(totalBytes)) }),
    signal,
  });
  if (upload.status !== 201) throw new Error(`upload failed (HTTP ${upload.status})`);
  const { job_id: jobId } = JSON.parse(upload.body);
  onProgress({ step: 'analysis', fraction: 0 });
  for (;;) {
    const job = await (await fetch(`${server}/videos/${jobId}`, { signal })).json();
    if (job.status === 'done') return job;
    if (job.status === 'failed') throw new Error(job.error);
    onProgress({ step: 'analysis', fraction: job.progress ?? 0 });
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    signal.throwIfAborted();
  }
}
