import { File, Paths } from 'expo-file-system';

/** "shots" counts makes and misses (the hoop in view); "form" measures the shooter's form (filmed from the side). */
export type Mode = 'shots' | 'form';

export type ShotResults = {
  mode?: 'shots'; // missing in sessions saved before form checks
  attempts: number;
  makes: number;
  duration: number; // seconds
  // arc_ft: feet the ball rose above the rim; null when not measured, missing in sessions saved before arcs.
  shots: { time: number; made: boolean; arc_ft?: number | null }[];
};
export type FormShot = {
  time: number; // the release
  knee_bend: number | null; // degrees at the bottom of the dip, 180 = straight
  elbow_at_release: number; // degrees, 180 = straight
  release_timing: 'rising' | 'at the top' | 'falling' | null; // null: a set shot, no jump
  follow_through: number; // seconds the shooting hand stayed above the head
};
export type FormResults = { mode: 'form'; attempts: number; duration: number; shots: FormShot[] };
export type Results = ShotResults | FormResults;
export type Session = Results & { id: string; date: string };
export type ShotSession = ShotResults & { id: string; date: string };

export function isForm(results: Results): results is FormResults {
  return results.mode === 'form';
}

export function isShots(session: Session): session is ShotSession {
  return !isForm(session);
}

/** A session in a list: the big value on the right, the line under its date, and both for screen readers. */
export function listSummary(session: Session) {
  if (isForm(session)) {
    const shots = `${session.attempts} ${session.attempts === 1 ? 'shot' : 'shots'}`;
    return { value: 'Form', detail: `${clock(session.duration)} · ${shots}`, spoken: `form check, ${shots}` };
  }
  return {
    value: `${percent(session)}%`,
    detail: `${clock(session.duration)} · ${session.makes} of ${session.attempts}`,
    spoken: `${session.makes} of ${session.attempts} made, ${percent(session)}%`,
  };
}

const store = () => new File(Paths.document, 'sessions.json');

/** Saved sessions, newest first. */
export async function loadSessions(): Promise<Session[]> {
  const file = store();
  if (!file.exists) return [];
  // Servers from before Oct 28 sent no duration; the last shot is the best stand-in.
  return (JSON.parse(await file.text()) as Session[]).map((s) => ({ ...s, duration: s.duration ?? s.shots.at(-1)?.time ?? 0 }));
}

export async function saveSession(results: Results): Promise<Session> {
  const session = { ...results, id: String(Date.now()), date: new Date().toISOString() };
  const sessions = await loadSessions();
  const file = store();
  if (!file.exists) file.create();
  await file.write(JSON.stringify([session, ...sessions]));
  return session;
}

export function percent({ makes, attempts }: { makes: number; attempts: number }) {
  return attempts ? Math.round((100 * makes) / attempts) : 0;
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
