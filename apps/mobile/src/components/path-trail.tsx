import React from 'react';
import { Pressable, View } from 'react-native';
import { answerClass } from '@dsa/core';

import { AppText } from './app-text';
import { fr } from '@/i18n/fr';
import { useTheme } from '@/theme';
import type { PathEntry } from '@/services/types';

export interface PathTrailProps {
  path: PathEntry[];
  /** When set, each row is tappable and reports the step to go back to. */
  onSelect?: (stepIndex: number) => void;
  /** Newest first. The player usually cares about where they just were. */
  reverse?: boolean;
  testID?: string;
}

/**
 * Only the traversed path, never future or eliminated branches
 * (GRAPH_SPECIFICATION §6). Ruled rows rather than cards: this is a list of what
 * was said, and it should read like one.
 */
export function PathTrail({ path, onSelect, reverse = true, testID }: PathTrailProps) {
  const theme = useTheme();
  if (path.length === 0) {
    return (
      <AppText variant="small" tone="faint" testID={testID}>
        {fr.game.trailEmpty}
      </AppText>
    );
  }

  const rows = reverse ? [...path].reverse() : path;

  return (
    <View testID={testID}>
      {rows.map((entry) => {
        const cls = answerClass(entry.answer_label);
        const colors = theme.colors.answers[cls];
        const row = (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space.sm,
              paddingVertical: theme.space.sm,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.line,
              minHeight: onSelect ? theme.touch.icon : undefined,
            }}
          >
            <AppText variant="micro" tone="faint" style={{ width: 22 }}>
              {entry.step_index + 1}
            </AppText>
            <AppText variant="body" weight="medium" numberOfLines={1} style={{ flex: 1 }}>
              {entry.text}
            </AppText>
            <View
              style={{
                backgroundColor: colors.fill,
                borderRadius: theme.radius.chip,
                paddingHorizontal: theme.space.sm,
                paddingVertical: 3,
              }}
            >
              <AppText variant="micro" weight="bold" style={{ color: colors.ink }}>
                {fr.answers[cls]}
              </AppText>
            </View>
          </View>
        );

        return onSelect ? (
          <Pressable
            key={entry.step_index}
            testID={`trail-step-${entry.step_index}`}
            accessibilityRole="button"
            accessibilityLabel={`${entry.text} — ${fr.answers[cls]}`}
            onPress={() => onSelect(entry.step_index)}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            {row}
          </Pressable>
        ) : (
          <View key={entry.step_index}>{row}</View>
        );
      })}
    </View>
  );
}
