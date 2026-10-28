import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText } from '../analyze';
import { clock, dayLabel, percent, type Session, loadSessions } from '../sessions';
import { colors } from '../theme';

const CHART_SESSIONS = 10;
const CHART_HEIGHT = 120;

export default function History() {
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadSessions().then(setSessions, (error) => setMessage(`Couldn't load your sessions: ${errorText(error)}`));
  }, []);

  const makes = sessions.reduce((sum, s) => sum + s.makes, 0);
  const attempts = sessions.reduce((sum, s) => sum + s.attempts, 0);
  const overall = percent({ makes, attempts });
  const chart = sessions.slice(0, CHART_SESSIONS).reverse(); // oldest on the left
  return (
    <ScrollView contentContainerStyle={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Home" style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>‹ Home</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>
        History
      </Text>
      {message ? <Text style={styles.label}>{message}</Text> : null}

      {sessions.length ? (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>All sessions</Text>
            <Text style={styles.bigNumber}>{overall}%</Text>
            <Text style={styles.label}>
              {makes} of {attempts} made over {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
            </Text>
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel={`Shooting percentage by session, oldest first: ${chart.map((s) => `${percent(s)}%`).join(', ')}`}
              style={styles.chart}>
              {chart.map((session, index) => (
                <View key={session.id} style={styles.barColumn}>
                  <Text style={styles.barValue}>{percent(session)}%</Text>
                  <View
                    style={[
                      styles.bar,
                      { height: Math.max(6, (CHART_HEIGHT * percent(session)) / 100) },
                      index === chart.length - 1 && styles.latestBar,
                    ]}
                  />
                </View>
              ))}
            </View>
          </View>

          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Sessions
          </Text>
          <View style={styles.list}>
            {sessions.map((session, index) => (
              <Pressable
                key={session.id}
                accessibilityRole="button"
                accessibilityLabel={`${dayLabel(session.date)}: ${session.makes} of ${session.attempts} made, ${percent(session)}%`}
                style={[styles.row, index > 0 && styles.rowDivider]}
                onPress={() => router.push(`/results/${session.id}`)}>
                <View>
                  <Text style={styles.rowTitle}>{dayLabel(session.date)}</Text>
                  <Text style={styles.label}>
                    {clock(session.duration)} · {session.makes} of {session.attempts}
                  </Text>
                </View>
                <Text style={styles.rowValue}>{percent(session)}%</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No sessions yet</Text>
          <Text style={styles.label}>Your shooting percentage over time will show here.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingHorizontal: 20,
    gap: 18,
  },
  back: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
  },
  backText: {
    color: colors.accent,
    fontSize: 17,
    fontWeight: '500',
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '700',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 20,
    gap: 4,
  },
  cardTitle: {
    color: colors.secondary,
    fontSize: 15,
    fontWeight: '600',
  },
  bigNumber: {
    color: colors.text,
    fontSize: 40,
    fontWeight: '700',
  },
  label: {
    color: colors.secondary,
    fontSize: 15,
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginTop: 16,
    paddingBottom: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  barValue: {
    color: colors.secondary,
    fontSize: 12,
    fontWeight: '600',
  },
  bar: {
    alignSelf: 'stretch',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    backgroundColor: colors.miss,
  },
  latestBar: {
    backgroundColor: colors.accent,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 8,
  },
  list: {
    backgroundColor: colors.card,
    borderRadius: 18,
    paddingHorizontal: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  rowValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '600',
  },
});
