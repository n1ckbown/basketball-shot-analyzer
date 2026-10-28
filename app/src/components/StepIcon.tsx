import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '../theme';

/** A checklist mark: a filled check when done, an accent ring while in progress, a gray ring otherwise. */
export function StepIcon({ state }: { state: 'done' | 'active' | 'waiting' }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22">
      {state === 'done' ? (
        <>
          <Circle cx={11} cy={11} r={11} fill={colors.accent} />
          <Path
            d="M6.5 11.5l3 3 6-6.5"
            stroke={colors.onAccent}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </>
      ) : (
        <Circle
          cx={11}
          cy={11}
          r={9.5}
          stroke={state === 'active' ? colors.accent : colors.miss}
          strokeWidth={state === 'active' ? 3 : 2}
          fill="none"
        />
      )}
    </Svg>
  );
}
