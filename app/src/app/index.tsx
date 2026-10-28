import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorText } from '../analyze';
import { Ring } from '../components/Ring';
import { clock, dayLabel, percent, type Session, loadSessions } from '../sessions';
import { colors } from '../theme';

const RECENT_COUNT = 5;

export default function Home() {
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [message, setMessage] = useState('');

  // Reload whenever Home comes back into view, so a just-analyzed session shows up.
  useFocusEffect(
    useCallback(() => {
      loadSessions().then(setSessions, (error) => setMessage(`Couldn't load your sessions: ${errorText(error)}`));
    }, []),
  );

  async function pickVideo() {
    setMessage('');
    try {
      // iOS hands over the original video file only with photo library read access.
      if (Platform.OS === 'ios' && !(await ImagePicker.requestMediaLibraryPermissionsAsync()).granted) {
        setMessage("Can't open videos: allow photo library access in Settings.");
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
      if (!picked.canceled) router.push({ pathname: '/analyze', params: { uri: picked.assets[0].uri } });
    } catch (error) {
      setMessage(`Couldn't open video: ${errorText(error)}`);
    }
  }

  const latest = sessions[0];
  return (
    <ScrollView contentContainerStyle={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }]}>
      <View style={styles.header}>
        <Text style={styles.date}>
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
        </Text>
        <Text accessibilityRole="header" style={styles.title}>
          Shooting
        </Text>
      </View>

      {latest ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Latest session: ${percent(latest)}%, ${latest.makes} of ${latest.attempts} made`}
          style={[styles.card, styles.latest]}
          onPress={() => router.push(`/results/${latest.id}`)}>
          <Ring size={76} stroke={9} fraction={percent(latest) / 100} />
          <View style={styles.latestText}>
            <Text style={styles.label}>Latest session</Text>
            <Text style={styles.bigNumber}>{percent(latest)}%</Text>
            <Text style={styles.label}>
              {latest.makes} of {latest.attempts} made · {dayLabel(latest.date).toLowerCase()}
            </Text>
          </View>
        </Pressable>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No sessions yet</Text>
          <Text style={styles.label}>Record a session or upload a video to see your makes and misses.</Text>
        </View>
      )}

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" style={[styles.button, styles.primary]} onPress={() => router.push('/record')}>
          <Text style={[styles.buttonText, styles.primaryText]}>Start a session</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.button} onPress={pickVideo}>
          <Text style={styles.buttonText}>Upload a video</Text>
        </Pressable>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>

      {sessions.length ? (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Recent
          </Text>
          <View style={styles.list}>
            {sessions.slice(0, RECENT_COUNT).map((session, index) => (
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
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingHorizontal: 20,
    gap: 24,
  },
  header: {
    gap: 4,
  },
  date: {
    color: colors.secondary,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
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
    gap: 6,
  },
  latest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  latestText: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
  },
  label: {
    color: colors.secondary,
    fontSize: 15,
  },
  bigNumber: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '700',
  },
  actions: {
    gap: 12,
  },
  button: {
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.accent,
  },
  buttonText: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
  },
  primaryText: {
    color: colors.onAccent,
  },
  message: {
    color: colors.secondary,
    fontSize: 15,
    textAlign: 'center',
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
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
