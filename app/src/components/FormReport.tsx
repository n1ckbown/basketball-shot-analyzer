import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { clock, type FormShot } from '../sessions';
import { colors } from '../theme';

// Tips appear only where a common coaching cue clearly applies; otherwise the numbers speak for themselves.
const STRAIGHT_ARM = 160; // degrees: a shooting arm that finishes below this is still bent
const HELD_FOLLOW_THROUGH = 0.5; // seconds
const TIMING_LABELS = { rising: 'on the way up', 'at the top': 'at the top', falling: 'on the way down' } as const;

function capitalized(text: string) {
  return text[0].toUpperCase() + text.slice(1);
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** How far a typical shot is from the middle one: half the range of the middle two-thirds of shots. */
function spread(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length / 6);
  return (sorted[sorted.length - 1 - cut] - sorted[cut]) / 2;
}

/** The form check's measurements: what is typical for this shooter, how consistent it is, and each shot. */
export function FormReport({ shots, bottomInset }: { shots: FormShot[]; bottomInset: number }) {
  if (!shots.length) {
    return (
      <Text style={styles.label}>
        No shots found. Film from the side with your whole body and the ball in the picture.
      </Text>
    );
  }
  const knees = shots.flatMap((shot) => (shot.knee_bend == null ? [] : [shot.knee_bend]));
  const elbows = shots.map((shot) => shot.elbow_at_release);
  const holds = shots.map((shot) => shot.follow_through);
  const timings = (['rising', 'at the top', 'falling'] as const).map((timing) => ({
    timing,
    count: shots.filter((shot) => shot.release_timing === timing).length,
  }));
  const mostCommon = [...timings].sort((a, b) => b.count - a.count)[0];
  const consistency = (values: number[], unit: string) =>
    values.length > 2 ? ` · varies by about ${Math.round(spread(values))}${unit} shot to shot` : '';

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 24 }]}>
      <Measure
        title="Knee bend"
        value={knees.length ? `${Math.round(median(knees))}°` : '–'}
        detail={
          knees.length
            ? `At the bottom of your dip (180° is straight)${consistency(knees, '°')}`
            : 'Your legs were not in the picture.'
        }
      />
      <Measure
        title="Elbow at release"
        value={`${Math.round(median(elbows))}°`}
        detail={`180° is a straight arm${consistency(elbows, '°')}`}
        tip={median(elbows) < STRAIGHT_ARM ? 'Try finishing with a straighter shooting arm.' : undefined}
      />
      <Measure
        title="Release"
        value={mostCommon.count ? capitalized(TIMING_LABELS[mostCommon.timing]) : 'No jump'}
        detail={
          timings
            .filter(({ count }) => count)
            .map(({ timing, count }) => `${count} ${TIMING_LABELS[timing]}`)
            .join(' · ') || 'Set shots: your feet stayed on the ground.'
        }
        tip={mostCommon.count && mostCommon.timing === 'falling' ? 'Try letting go at the top of your jump.' : undefined}
      />
      <Measure
        title="Follow-through"
        value={`${median(holds).toFixed(1)} s`}
        detail={`How long your shooting hand stayed up after release${consistency(holds, ' s')}`}
        tip={median(holds) < HELD_FOLLOW_THROUGH ? 'Hold your follow-through until the ball reaches the rim.' : undefined}
      />

      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Shots
      </Text>
      <View style={styles.list}>
        {shots.map((shot, index) => (
          <View key={index} style={[styles.row, index > 0 && styles.rowDivider]}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowTitle}>Shot {index + 1}</Text>
              <Text style={styles.rowTime}>{clock(shot.time)}</Text>
            </View>
            <Text style={styles.label}>
              {[
                shot.knee_bend == null ? null : `Knees ${shot.knee_bend}°`,
                `elbow ${shot.elbow_at_release}°`,
                shot.release_timing ? TIMING_LABELS[shot.release_timing] : 'no jump',
                `held ${shot.follow_through.toFixed(1)} s`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Measure({ title, value, detail, tip }: { title: string; value: string; detail: string; tip?: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{detail}</Text>
      {tip ? <Text style={styles.tip}>{tip}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 4,
  },
  cardTitle: {
    color: colors.secondary,
    fontSize: 15,
    fontWeight: '600',
  },
  value: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
  },
  label: {
    color: colors.secondary,
    fontSize: 15,
  },
  tip: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 4,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 8,
  },
  list: {
    backgroundColor: colors.card,
    borderRadius: 18,
    paddingHorizontal: 18,
  },
  row: {
    paddingVertical: 12,
    gap: 2,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  rowTime: {
    color: colors.secondary,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
});
