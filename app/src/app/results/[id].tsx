import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText } from '../../analyze';
import { Ring } from '../../components/Ring';
import { clock, dayLabel, percent, type Session, loadSessions } from '../../sessions';
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

  const made = session.shots.filter((shot) => shot.made);
  const length = Math.max(session.duration, 1);
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
          <Stat label="Shots" value={String(session.attempts)} />
          <Stat label="Per minute" value={(session.attempts / (length / 60)).toFixed(1)} />
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
