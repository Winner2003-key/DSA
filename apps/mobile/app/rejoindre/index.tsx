import React from 'react';
import { useRouter } from 'expo-router';

import { Screen, SoundToggle, TopBar } from '@/components';
import { fr } from '@/i18n/fr';
import { JoinView } from '@/views/join-view';

export default function RejoindreScreen() {
  const router = useRouter();
  return (
    <Screen scroll testID="screen-rejoindre">
      <TopBar onBack={() => router.replace('/ami')} backLabel={fr.app.back} right={<SoundToggle />} />
      <JoinView />
    </Screen>
  );
}
