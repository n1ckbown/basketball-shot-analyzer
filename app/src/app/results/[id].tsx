import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText } from '../../analyze';
import { FormReport } from '../../components/FormReport';
import { Ring } from '../../components/Ring';
import { clock, dayLabel, isForm, percent, type Session, loadSessions } from '../../sessions';
import { colors } from '../../theme';

export default function Results() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadSessions().then(
      (sessions) => {
        const found = sessions.find((s) => s.id === id);
        if (found) setSession(found);
        else setMessage('This session was not found.');
      },
      (error) => setMessage(`Couldn't load this session: ${errorText(error)}`),
    );
  }, [id]);

  const done = (
    <Pressable accessibilityRole="button" style={styles.done} onPress={() => router.dismissTo('/')}>
      <Text style={styles.doneText}>Done</Text>
    </Pressable>
  );

  if (!session) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
        <View style={styles.header}>
          <View />
          {done}
        </View>
        <Text style={styles.label}>{message}</Text>
      </View>
    );
  }

  if (isForm(session)) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
        <View style={styles.header}>
          <View>
            <Text accessibilityRole="header" style={styles.title}>
              {dayLabel(session.date)}
            </Text>
            <Text style={styles.label}>Form check · {clock(session.duration)}</Text>
          </View>
          {done}
        </View>
        <FormReport shots={session.shots} bottomInset={insets.bottom} />
      </View>
    );
  }

  const made = session.shots.filter((shot) => shot.made);
  const length = Math.max(session.duration, 1);
  const arcs = session.shots.filter((shot) => shot.arc_ft != null);
  const makeArcs = arcs.filter((shot) => shot.made);
  const missArcs = arcs.filter((shot) => !shot.made);
  const arcNote = !arcs.length
    ? "Arc not measured: the top of the ball's flight wasn't in view. Leave room above the rim when you set up."
    : makeArcs.length && missArcs.length
      ? `Arc: your makes peaked ${averageArc(makeArcs)} above the rim on average, your misses ${averageArc(missArcs)}.`
      : `Arc measured on ${arcs.length} of ${session.shots.length} shots.`;
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <View>
          <Text accessibilityRole="header" style={styles.title}>
            {dayLabel(session.date)}
          </Text>
          <Text style={styles.label}>{clock(session.duration)} session</Text>
        </View>
        {done}
      </View>

      <View style={styles.summary}>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={`${percent(session)}% made, ${session.makes} of ${session.attempts}`}
          style={styles.ring}>
          <Ring size={150} stroke={14} fraction={percent(session) / 100} />
          <Text style={styles.ringText}>{percent(session)}%</Text>
        </View>
        <View style={styles.stats}>
          <Stat label="Made" value={String(session.makes)} accent />
          <Stat label="Missed" value={String(session.attempts - session.makes)} />
          <Stat label="Per minute" value={(session.attempts / (length / 60)).toFixed(1)} />
          <Stat label="Avg arc" value={arcs.length ? averageArc(arcs) : '–'} />
        </View>
      </View>

      {session.shots.length ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Shots over time</Text>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={
              made.length ? `Makes at ${made.map((shot) => clock(shot.time)).join(', ')}` : 'No makes'
            }
            style={styles.timeline}>
            <View style={styles.timelineTrack} />
            {session.shots.map((shot, index) => (
              <View
                key={index}
                style={[
                  styles.dot,
                  shot.made ? styles.makeDot : styles.missDot,
                  { left: `${(100 * shot.time) / length}%` },
                ]}
              />
            ))}
          </View>
          <View style={styles.timelineLabels}>
            <Text style={styles.small}>0:00</Text>
            <Text style={styles.small}>{clock(session.duration)}</Text>
          </View>
          <Text style={styles.arcNote}>{arcNote}</Text>
        </View>
      ) : null}

      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Shots
      </Text>
      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
        {session.shots.length ? (
          session.shots.map((shot, index) => (
            <View key={index} style={[styles.row, index > 0 && styles.rowDivider]}>
              <View style={[styles.rowDot, { backgroundColor: shot.made ? colors.accent : colors.miss }]} />
              <Text style={styles.rowTitle}>Shot {index + 1}</Text>
              <Text style={styles.rowTime}>{clock(shot.time)}</Text>
              <Text
                accessibilityLabel={shot.arc_ft != null ? `arc ${shot.arc_ft.toFixed(1)} feet` : 'arc not measured'}
                style={styles.rowArc}>
                {shot.arc_ft != null ? `${shot.arc_ft.toFixed(1)} ft` : '–'}
              </Text>
              <Text style={[styles.rowResult, shot.made && styles.makeText]}>{shot.made ? 'Make' : 'Miss'}</Text>
            </View>
          ))
        ) : (
          <Text style={[styles.label, styles.empty]}>No shots found. Check that the hoop is in view.</Text>
        )}
      </ScrollView>
    </View>
  );
}

function averageArc(shots: { arc_ft?: number | null }[]) {
  return `${(shots.reduce((sum, shot) => sum + (shot.arc_ft ?? 0), 0) / shots.length).toFixed(1)} ft`;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.small}>{label}</Text>
      <Text style={[styles.statValue, accent && styles.makeText]}>{value}</Text>
    </View>
  );
}

const DOT_MAKE = 14;
const DOT_MISS = 9;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 20,
    gap: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
  },
  label: {
    color: colors.secondary,
    fontSize: 15,
  },
  small: {
    color: colors.tertiary,
    fontSize: 13,
  },
  done: {
    paddingVertical: 10,
    paddingLeft: 16,
  },
  doneText: {
    color: colors.accent,
    fontSize: 17,
    fontWeight: '600',
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  ring: {
    width: 150,
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringText: {
    position: 'absolute',
    color: colors.text,
    fontSize: 36,
    fontWeight: '700',
  },
  stats: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 14,
  },
  stat: {
    width: '50%',
    gap: 2,
  },
  statValue: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '700',
  },
  makeText: {
    color: colors.accent,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 10,
  },
  cardTitle: {
    color: colors.secondary,
    fontSize: 15,
    fontWeight: '600',
  },
  timeline: {
    height: 28,
    justifyContent: 'center',
  },
  timelineTrack: {
    height: 2,
    backgroundColor: colors.separator,
  },
  dot: {
    position: 'absolute',
    borderRadius: DOT_MAKE / 2,
  },
  makeDot: {
    width: DOT_MAKE,
    height: DOT_MAKE,
    top: (28 - DOT_MAKE) / 2,
    marginLeft: -DOT_MAKE / 2,
    backgroundColor: colors.accent,
  },
  missDot: {
    width: DOT_MISS,
    height: DOT_MISS,
    top: (28 - DOT_MISS) / 2,
    marginLeft: -DOT_MISS / 2,
    backgroundColor: colors.miss,
  },
  timelineLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: -10,
  },
  list: {
    flex: 1,
    backgroundColor: colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  rowDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  rowTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
  },
  rowTime: {
    color: colors.secondary,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
  rowArc: {
    width: 52,
    textAlign: 'right',
    color: colors.tertiary,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  arcNote: {
    color: colors.secondary,
    fontSize: 14,
    lineHeight: 19,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  rowResult: {
    width: 44,
    textAlign: 'right',
    color: colors.secondary,
    fontSize: 16,
    fontWeight: '600',
  },
  empty: {
    paddingVertical: 16,
  },
});
