import { File, Paths } from 'expo-file-system';

export type Results = {
  attempts: number;
  makes: number;
  duration: number; // seconds
  shots: { time: number; made: boolean }[];
};
export type Session = Results & { id: string; date: string };

const store = () => new File(Paths.document, 'sessions.json');

/** Saved sessions, newest first. */
export async function loadSessions(): Promise<Session[]> {
  const file = store();
  return file.exists ? JSON.parse(await file.text()) : [];
}

export async function saveSession(results: Results): Promise<Session> {
  const session = { ...results, id: String(Date.now()), date: new Date().toISOString() };
  const sessions = await loadSessions();
  const file = store();
  if (!file.exists) file.create();
  await file.write(JSON.stringify([session, ...sessions]));
  return session;
}

export function percent(session: Results) {
  return session.attempts ? Math.round((100 * session.makes) / session.attempts) : 0;
}

export function clock(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function dayLabel(date: string) {
  const day = new Date(date);
  return day.toDateString() === new Date().toDateString()
    ? 'Today'
    : day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
