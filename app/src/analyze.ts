import { File, UploadType } from 'expo-file-system';

import type { Results } from './sessions';

const POLL_INTERVAL_MS = 3000;

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Uploads a video to the analysis server and waits for its makes and misses. */
export async function analyzeVideo(uri: string, onStatus: (text: string) => void, signal: AbortSignal): Promise<Results> {
  const server = process.env.EXPO_PUBLIC_SERVER_URL;
  if (!server) throw new Error('no server address set (EXPO_PUBLIC_SERVER_URL).');
  onStatus('Uploading… 0%');
  const upload = await new File(uri).upload(`${server}/videos`, {
    uploadType: UploadType.MULTIPART,
    fieldName: 'file', // The server reads this field; the native default is the file name, not 'file' as documented.
    // iPhones record .mov and Android phones .mp4; the server accepts only these two types.
    mimeType: uri.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/quicktime',
    // On the phone these arrive as BigInt despite the number type, and BigInt can't mix with numbers.
    onProgress: ({ bytesSent, totalBytes }) =>
      onStatus(`Uploading… ${Math.min(99, Math.floor((100 * Number(bytesSent)) / Number(totalBytes)))}%`),
    signal,
  });
  if (upload.status !== 201) throw new Error(`upload failed (HTTP ${upload.status})`);
  const { job_id: jobId } = JSON.parse(upload.body);
  onStatus('Finding your shots… this takes about half as long as the video.');
  for (;;) {
    const job = await (await fetch(`${server}/videos/${jobId}`, { signal })).json();
    if (job.status === 'done') return job;
    if (job.status === 'failed') throw new Error(job.error);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    signal.throwIfAborted();
  }
}
