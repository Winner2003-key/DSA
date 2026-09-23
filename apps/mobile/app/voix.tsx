import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppText, LinkButton, PrimaryButton, Screen, SoundToggle, TalkModeChips, TopBar } from '@/components';
import { fr } from '@/i18n/fr';
import { clearCalibration, useVoiceSettings } from '@/speech/voice-settings';
import { useTheme } from '@/theme';
import { CalibrationPanel, CalibrationSummary } from '@/views/calibration-panel';
import { Mic } from '@/components';

/**
 * "Réglages de la voix": how to talk (hold or free), and the Tireur's calibration,
 * which can be redone here at any time. Everything stays on this device.
 */
export default function VoiceSettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const settings = useVoiceSettings();
  const [calibrating, setCalibrating] = useState(false);

  return (
    <Screen scroll testID="screen-voix">
      <TopBar
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        backLabel={fr.app.back}
        right={<SoundToggle />}
      />
      <View style={{ gap: theme.space.lg, paddingTop: theme.space.sm, paddingBottom: theme.space.xxl }}>
        <View style={{ gap: theme.space.xxs }}>
          <AppText variant="display" weight="bold" tight>
            {fr.voice.settingsTitle}
          </AppText>
          <AppText variant="body" tone="soft">
            {fr.voice.settingsIntro}
          </AppText>
        </View>

        <View style={{ gap: theme.space.sm }}>
          <AppText variant="lead" weight="semibold" tone="soft">
            {fr.voice.talkModeTitle}
          </AppText>
          <TalkModeChips talkMode={settings.talkMode} disabled={calibrating} />
          <AppText variant="small" tone="faint">
            {settings.talkMode === 'HOLD' ? fr.voice.holdToTalkHint : fr.voice.freeTalkHint}
          </AppText>
        </View>

        <View style={{ gap: theme.space.sm }}>
          <AppText variant="lead" weight="semibold" tone="soft">
            {fr.voice.calibrationTitle}
          </AppText>
          {calibrating ? (
            <CalibrationPanel startImmediately showTalkMode={false} onDone={() => setCalibrating(false)} />
          ) : (
            <>
              {settings.calibration ? (
                <CalibrationSummary calibration={settings.calibration} />
              ) : (
                <AppText variant="body" tone="soft" testID="calibration-none">
                  {fr.voice.notCalibrated}
                </AppText>
              )}
              <PrimaryButton
                testID="voice-settings-calibrate"
                icon={Mic}
                label={settings.calibration ? fr.voice.calibrateAgain : fr.voice.calibrate}
                onPress={() => setCalibrating(true)}
              />
              {settings.calibration ? (
                <LinkButton testID="voice-settings-clear" label={fr.voice.clear} onPress={clearCalibration} />
              ) : null}
            </>
          )}
        </View>
      </View>
    </Screen>
  );
}
