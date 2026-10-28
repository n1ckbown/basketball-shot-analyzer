import Svg, { Circle } from 'react-native-svg';

import { colors } from '../theme';

/** A progress ring filled clockwise from the top by `fraction` (0 to 1). */
export function Ring({ size, stroke, fraction }: { size: number; stroke: number; fraction: number }) {
  const center = size / 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <Svg width={size} height={size}>
      <Circle cx={center} cy={center} r={radius} stroke={colors.ringTrack} strokeWidth={stroke} fill="none" />
      {fraction > 0 ? (
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={colors.accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${fraction * circumference} ${circumference}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      ) : null}
    </Svg>
  );
}
