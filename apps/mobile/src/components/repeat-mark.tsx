import React from 'react';
import { View } from 'react-native';

/**
 * Three stacked bars. The book's repeated codes ("OUI OUI OUI") are one held
 * sound, not three words, and this game exists for people who don't read — so the
 * repeat is drawn as well as spelled.
 */
export function RepeatMark({ color, size = 18 }: { color: string; size?: number }) {
  const bar = (width: number, key: number) => (
    <View
      key={key}
      style={{
        width,
        height: Math.max(2, size / 7),
        borderRadius: 999,
        backgroundColor: color,
        marginBottom: Math.max(2, size / 8),
      }}
    />
  );
  return <View style={{ alignItems: 'flex-start' }}>{[size, size * 0.72, size * 0.44].map((w, i) => bar(w, i))}</View>;
}
