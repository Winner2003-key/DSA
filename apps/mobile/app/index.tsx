import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  AppText,
  BookOpen,
  IconButton,
  Mic,
  Monitor,
  Moon,
  OfflineBadge,
  Play,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SoundToggle,
  Sun,
  TopBar,
  Users,
} from '@/components';
import { fr } from '@/i18n/fr';
import { OFFLINE_ENABLED } from '@/services';
import { useTheme, useThemePreference, type ThemePreference } from '@/theme';

/** One button cycles the theme; its icon shows the current choice. */
const THEME_CYCLE: Record<ThemePreference, { next: ThemePreference; icon: typeof Sun; label: string }> = {
  system: { next: 'light', icon: Monitor, label: fr.app.themeSystem },
  light: { next: 'dark', icon: Sun, label: fr.app.themeLight },
  dark: { next: 'system', icon: Moon, label: fr.app.themeDark },
};

export default function AccueilScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { preference, setPreference } = useThemePreference();
  const themeStep = THEME_CYCLE[preference];

  return (
    <Screen scroll testID="screen-accueil">
      <TopBar
        right={
          <>
            <IconButton
              testID="theme-toggle"
              icon={themeStep.icon}
              accessibilityLabel={`${fr.app.theme} : ${themeStep.label}`}
              onPress={() => setPreference(themeStep.next)}
            />
            <IconButton
              testID="home-voice-settings"
              icon={Mic}
              accessibilityLabel={fr.voice.settingsLink}
              onPress={() => router.push('/voix')}
            />
            <SoundToggle />
          </>
        }
      />

      <View style={{ flex: 1, justifyContent: 'center', paddingVertical: theme.space.xxl, gap: theme.space.xxl }}>
        <View style={{ gap: theme.space.xs }}>
          {OFFLINE_ENABLED ? <OfflineBadge /> : null}
          <AppText variant="colossal" weight="bold" tight>
            {fr.app.name}
          </AppText>
          <AppText variant="lead" tone="soft">
            {fr.app.tagline}
          </AppText>
        </View>

        <View style={{ gap: theme.space.sm }}>
          <PrimaryButton testID="home-play" icon={Play} label={fr.home.play} onPress={() => router.push('/jouer')} />
          <SecondaryButton
            testID="home-friend"
            icon={Users}
            label={fr.home.playWithFriend}
            onPress={() => router.push('/ami')}
          />
          <SecondaryButton
            testID="home-explore"
            icon={BookOpen}
            label={`${fr.home.explore} · ${fr.app.soon}`}
            disabled
            onPress={() => undefined}
          />
        </View>
      </View>
    </Screen>
  );
}
