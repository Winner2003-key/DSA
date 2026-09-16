import React from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from './app-text';
import { fr } from '@/i18n/fr';
import { useSpeech } from '@/speech/use-speech';
import { useTheme } from '@/theme';

/** The offline demo must never be mistaken for a real game against the server. */
export function OfflineBadge() {
  const theme = useTheme();
  return (
    <View
      testID="offline-badge"
      style={{
        alignSelf: 'flex-start',
        borderRadius: theme.radius.chip,
        borderWidth: 1.5,
        borderColor: theme.colors.brass,
        paddingHorizontal: theme.space.sm,
        paddingVertical: 4,
      }}
    >
      <AppText variant="micro" weight="semibold" tone="brass">
        {fr.app.offlineBadge}
      </AppText>
    </View>
  );
}

export interface TopBarProps {
  onBack?: () => void;
  backLabel?: string;
  right?: React.ReactNode;
}

export function TopBar({ onBack, backLabel, right }: TopBarProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: theme.touch.icon,
        marginBottom: theme.space.xs,
      }}
    >
      {onBack ? (
        <Pressable
          testID="top-back"
          accessibilityRole="button"
          accessibilityLabel={backLabel ?? fr.app.back}
          onPress={onBack}
          hitSlop={12}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: theme.space.xs })}
        >
          <AppText variant="body" weight="medium" tone="soft">
            ‹ {backLabel ?? fr.app.back}
          </AppText>
        </Pressable>
      ) : (
        <View />
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>{right}</View>
    </View>
  );
}

/** Mute toggle. Speech is a real channel here, so the control is always reachable. */
export function SoundToggle() {
  const theme = useTheme();
  const { muted, toggleMuted } = useSpeech();
  return (
    <Pressable
      testID="sound-toggle"
      accessibilityRole="switch"
      accessibilityState={{ checked: !muted }}
      accessibilityLabel={muted ? fr.app.soundOff : fr.app.soundOn}
      onPress={toggleMuted}
      hitSlop={12}
      style={({ pressed }) => ({
        minHeight: theme.touch.icon,
        justifyContent: 'center',
        paddingHorizontal: theme.space.sm,
        borderRadius: theme.radius.chip,
        borderWidth: 1.5,
        borderColor: muted ? theme.colors.line : theme.colors.brass,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <AppText variant="small" weight="semibold" tone={muted ? 'faint' : 'brass'}>
        {muted ? '🔇' : '🔊'} {fr.app.sound}
      </AppText>
    </Pressable>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  const theme = useTheme();
  return (
    <View
      testID="error-banner"
      accessibilityRole="alert"
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.field,
        borderLeftWidth: 4,
        borderLeftColor: theme.colors.danger,
        padding: theme.space.md,
        gap: theme.space.xxs,
      }}
    >
      <AppText variant="small" weight="semibold" tone="danger">
        {fr.errorTitle}
      </AppText>
      <AppText variant="body">{message}</AppText>
      {onDismiss ? (
        <Pressable accessibilityRole="button" onPress={onDismiss} hitSlop={10} style={{ paddingTop: theme.space.xxs }}>
          <AppText variant="small" weight="semibold" tone="brass">
            {fr.app.close}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
