import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppText, NoticeBanner, OfflineBadge, PrimaryButton, Screen, SecondaryButton, SoundToggle, TopBar } from '@/components';
import { fr } from '@/i18n/fr';
import { OFFLINE_ENABLED } from '@/services';
import { useTheme } from '@/theme';
import { LogIn, Play } from '@/components';

/** "Jouer avec un ami": two phones, one room. Create it, or join it with its code. */
export default function AmiScreen() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Screen scroll testID="screen-ami">
      <TopBar onBack={() => router.replace('/')} backLabel={fr.app.home} right={<SoundToggle />} />
      <View style={{ flex: 1, justifyContent: 'center', gap: theme.space.xl, paddingVertical: theme.space.xl }}>
        <View style={{ gap: theme.space.xxs }}>
          {OFFLINE_ENABLED ? <OfflineBadge /> : null}
          <AppText variant="display" weight="bold" tight>
            {fr.friend.title}
          </AppText>
          <AppText variant="body" tone="soft">
            {fr.friend.intro}
          </AppText>
        </View>
        {OFFLINE_ENABLED ? <NoticeBanner tone="warn" title={fr.friend.needsServer} /> : null}
        <View style={{ gap: theme.space.sm }}>
          <PrimaryButton
            testID="friend-create"
            icon={Play}
            label={fr.friend.create}
            hint={fr.friend.createHint}
            disabled={OFFLINE_ENABLED}
            onPress={() => router.push('/jouer?ami=1')}
          />
          <SecondaryButton
            testID="friend-join"
            icon={LogIn}
            label={fr.friend.join}
            hint={fr.friend.joinHint}
            disabled={OFFLINE_ENABLED}
            onPress={() => router.push('/rejoindre')}
          />
        </View>
      </View>
    </Screen>
  );
}
