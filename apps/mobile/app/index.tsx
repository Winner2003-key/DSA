import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppText, Chip, OfflineBadge, PrimaryButton, Screen, SecondaryButton, SoundToggle, TopBar } from '@/components';
import { fr } from '@/i18n/fr';
import { OFFLINE_ENABLED } from '@/services';
import { useTheme, useThemePreference } from '@/theme';

export default function AccueilScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { preference, setPreference } = useThemePreference();

  return (
    <Screen scroll testID="screen-accueil">
      <TopBar right={<SoundToggle />} />

      <View style={{ flex: 1, justifyContent: 'center', paddingVertical: theme.space.xxl, gap: theme.space.xl }}>
        <View style={{ gap: theme.space.xxs }}>
          {OFFLINE_ENABLED ? <OfflineBadge /> : null}
          <AppText variant="colossal" weight="bold" tight>
            {fr.app.name}
          </AppText>
          <AppText variant="title" tone="brass" weight="medium">
            {fr.app.tagline}
          </AppText>
          <AppText variant="body" tone="soft" style={{ marginTop: theme.space.xs }}>
            {fr.home.intro}
          </AppText>
        </View>

        <View style={{ gap: theme.space.sm }}>
          <PrimaryButton testID="home-play" label={fr.home.play} onPress={() => router.push('/jouer')} />

          <View style={{ gap: theme.space.xxs }}>
            <SecondaryButton
              testID="home-friend"
              label={fr.home.playWithFriend}
              hint={fr.home.friendHint}
              disabled
              onPress={() => undefined}
            />
            <SoonNote />
          </View>

          <View style={{ gap: theme.space.xxs }}>
            <SecondaryButton
              testID="home-explore"
              label={fr.home.explore}
              hint={fr.home.exploreHint}
              disabled
              onPress={() => undefined}
            />
            <SoonNote />
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: theme.space.xs, paddingBottom: theme.space.lg }}>
        <Chip
          label={fr.app.themeSystem}
          selected={preference === 'system'}
          onPress={() => setPreference('system')}
          testID="theme-system"
        />
        <Chip
          label={fr.app.themeLight}
          selected={preference === 'light'}
          onPress={() => setPreference('light')}
          testID="theme-light"
        />
        <Chip
          label={fr.app.themeDark}
          selected={preference === 'dark'}
          onPress={() => setPreference('dark')}
          testID="theme-dark"
        />
      </View>
    </Screen>
  );
}

function SoonNote() {
  return (
    <AppText variant="micro" tone="brass" weight="semibold" style={{ alignSelf: 'flex-end' }}>
      {fr.app.soon}
    </AppText>
  );
}
