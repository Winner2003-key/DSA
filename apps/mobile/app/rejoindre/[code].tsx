import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen, SoundToggle, TopBar } from '@/components';
import { fr } from '@/i18n/fr';
import { JoinView } from '@/views/join-view';

/** `dsa://rejoindre/DSA-1234` and the web URL `/rejoindre/DSA-1234` (a shared link or a scanned QR code). */
export default function RejoindreCodeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  return (
    <Screen scroll testID="screen-rejoindre">
      <TopBar onBack={() => router.replace('/')} backLabel={fr.app.home} right={<SoundToggle />} />
      <JoinView initialCode={typeof params.code === 'string' ? params.code : null} />
    </Screen>
  );
}
