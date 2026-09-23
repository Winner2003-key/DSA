import React from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from './app-text';
import { ArrowLeft, House, IconButton, Volume2, VolumeX, X } from './icon';
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
  const label = backLabel ?? fr.app.back;
  // The label stays for screen readers; the icon says where the button goes.
  const icon = label === fr.app.home ? House : label === fr.app.quit || label === fr.lobby.cancel ? X : ArrowLeft;
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
      {onBack ? <IconButton testID="top-back" icon={icon} accessibilityLabel={label} onPress={onBack} /> : <View />}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs }}>{right}</View>
    </View>
  );
}

/** Mute toggle. Speech is a real channel here, so the control is always reachable. */
export function SoundToggle() {
  const { muted, toggleMuted } = useSpeech();
  return (
    <IconButton
      testID="sound-toggle"
      icon={muted ? VolumeX : Volume2}
      accessibilityRole="switch"
      accessibilityState={{ checked: !muted }}
      accessibilityLabel={muted ? fr.app.soundOff : fr.app.soundOn}
      active={!muted}
      onPress={toggleMuted}
    />
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
