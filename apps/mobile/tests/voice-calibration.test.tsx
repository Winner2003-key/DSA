/**
 * Calibration (GRAPH_SPECIFICATION §1, brief S7b §5): OUI ×2, OUIIII ×2, the values
 * shown simply and stored on the device, then a live test. Offered once to a Tireur
 * playing with Voix, and every time on a shared phone ("Calibrer pour ce Tireur").
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { parseCalibration } from '@dsa/voice';

import { setGameService } from '@/services';
import { OfflineGameService } from '@/services/offline-game-service';
import { resetVoiceSettingsForTests, setTalkMode, VOICE_KEYS } from '@/speech/voice-settings';
import { clearNameCacheForTests } from '@/state/use-names';
import { useGame } from '@/state/use-game';
import { CalibrationPanel } from '@/views/calibration-panel';
import { GameTable } from '@/views/game-table';
import VoiceSettingsScreen from '../app/voix';

import { envelopeOf, fakeMic, recordingOf, resetFakeMic, SILENCE_DB } from './fake-recorder';
import { renderWithProviders } from './helpers';

jest.mock('@/speech/recorder', () => require('./fake-recorder'));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), replace: jest.fn(), canGoBack: () => true }) }));

type Screen = Awaited<ReturnType<typeof renderWithProviders>>;

async function take(screen: Screen, voiceMs: number | 'silence') {
  fakeMic.next = voiceMs === 'silence' ? { ...recordingOf(0), envelope: envelopeOf([[1500, SILENCE_DB]]), durationMs: 1500 } : recordingOf(voiceMs);
  await waitFor(() => expect(screen.getByTestId('calibration-voice-idle')).toBeTruthy());
  await act(async () => {
    fireEvent.press(screen.getByTestId('calibration-voice'));
  });
  await waitFor(() => expect(screen.getByTestId('calibration-voice-listening')).toBeTruthy());
  await act(async () => {
    fireEvent.press(screen.getByTestId('calibration-voice'));
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetFakeMic();
  resetVoiceSettingsForTests();
  clearNameCacheForTests();
  setTalkMode('FREE');
});
afterEach(() => setGameService(null));

it('records OUI twice and OUIIII twice, shows the values and stores them', async () => {
  const onDone = jest.fn();
  const screen = await renderWithProviders(<CalibrationPanel onDone={onDone} />);
  await act(async () => {
    fireEvent.press(screen.getByTestId('calibration-start'));
  });

  expect(screen.getByTestId('calibration-instruction')).toHaveTextContent('Dis OUI normalement');
  expect(screen.getByTestId('calibration-take-count')).toHaveTextContent('Essai 1 sur 2');
  await take(screen, 'silence');
  await waitFor(() => expect(screen.getByTestId('calibration-notice')).toHaveTextContent(/^Je n’ai rien entendu/));
  expect(screen.getByTestId('calibration-take-count')).toHaveTextContent('Essai 1 sur 2');
  await take(screen, 300);
  await waitFor(() => expect(screen.getByTestId('calibration-take-count')).toHaveTextContent('Essai 2 sur 2'));
  await take(screen, 400);

  await waitFor(() => expect(screen.getByTestId('calibration-instruction')).toHaveTextContent('Dis OUIIII en le tenant longtemps'));
  await take(screen, 1100);
  await take(screen, 1300);

  await waitFor(() => expect(screen.getByTestId('calibration-result')).toBeTruthy());
  const summary = screen.getByTestId('calibration-summary');
  expect(summary).toHaveTextContent(/Ton OUI dure 0,4 s/);
  expect(summary).toHaveTextContent(/Ton OUIIII dure 1,2 s/);
  expect(summary).toHaveTextContent(/Au-delà de 0,8 s, c’est OUI OUI OUI/);
  expect(screen.queryByTestId('calibration-weak')).toBeNull();

  const stored = parseCalibration(JSON.parse((await AsyncStorage.getItem(VOICE_KEYS.calibration)) ?? 'null'));
  expect(stored).toEqual({ thresholdMs: 775, shortMedianMs: 350, longMedianMs: 1200, quality: 'good' });

  // Live test: "Dis l'un ou l'autre".
  await take(screen, 1400);
  await waitFor(() => expect(screen.getByTestId('calibration-understood')).toHaveTextContent('J’ai compris : OUI OUI OUI'));
  await take(screen, 300);
  await waitFor(() => expect(screen.getByTestId('calibration-understood')).toHaveTextContent('J’ai compris : OUI'));
  await take(screen, 800);
  await waitFor(() => expect(screen.getByTestId('calibration-understood')).toHaveTextContent(/Entre les deux/));

  await act(async () => {
    fireEvent.press(screen.getByTestId('calibration-done'));
  });
  expect(onDone).toHaveBeenCalled();
});

it('warns when the two sounds are too alike', async () => {
  const screen = await renderWithProviders(<CalibrationPanel startImmediately />);
  for (const ms of [400, 450, 500, 550]) await take(screen, ms);
  await waitFor(() => expect(screen.getByTestId('calibration-weak')).toHaveTextContent(/se ressemblent/));
});

it('shows the microphone refusal instead of crashing', async () => {
  fakeMic.error = 'PERMISSION_DENIED';
  const screen = await renderWithProviders(<CalibrationPanel startImmediately />);
  await act(async () => {
    fireEvent.press(screen.getByTestId('calibration-voice'));
  });
  await waitFor(() => expect(screen.getByTestId('calibration-mic-error')).toHaveTextContent(/Le micro est refusé/));
});

it('"Réglages de la voix" shows the stored values and redoes the calibration', async () => {
  await AsyncStorage.setItem(
    VOICE_KEYS.calibration,
    JSON.stringify({ thresholdMs: 700, shortMedianMs: 300, longMedianMs: 1100, quality: 'good' }),
  );
  const screen = await renderWithProviders(<VoiceSettingsScreen />);
  await waitFor(() => expect(screen.getByTestId('calibration-summary')).toHaveTextContent(/Au-delà de 0,7 s/));
  await act(async () => {
    fireEvent.press(screen.getByTestId('talk-mode-hold'));
  });
  expect(await AsyncStorage.getItem(VOICE_KEYS.talkMode)).toBe('HOLD');
  await act(async () => {
    fireEvent.press(screen.getByTestId('voice-settings-calibrate'));
  });
  expect(screen.getByTestId('calibration-instruction')).toHaveTextContent('Dis OUI normalement');
});

function Table({ sessionId, service }: { sessionId: string; service: OfflineGameService }) {
  const game = useGame(sessionId, { service, aiThinkingMs: 60_000 });
  return <GameTable sessionId={sessionId} game={game} />;
}

it('is offered once to a Tireur playing with Voix, and "Plus tard" is remembered', async () => {
  const service = new OfflineGameService({ persist: false });
  setGameService(service);
  const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'AI_DECOUVREUR', settings: { input_mode: 'VOICE' } });
  const screen = await renderWithProviders(<Table sessionId={sessionId} service={service} />);
  await waitFor(() => expect(screen.getByTestId('calibration-offer')).toBeTruthy());
  await act(async () => {
    fireEvent.press(screen.getByTestId('calibration-offer-later'));
  });
  expect(screen.queryByTestId('calibration-offer')).toBeNull();
  expect(await AsyncStorage.getItem(VOICE_KEYS.offered)).toBe('1');

  // A Buttons game never offers it.
  await AsyncStorage.clear();
  resetVoiceSettingsForTests();
  const other = await service.createSession({ graphSlug: 'mini', mode: 'AI_DECOUVREUR' });
  const buttons = await renderWithProviders(<Table sessionId={other.sessionId} service={service} />);
  await waitFor(() => expect(buttons.getByTestId('tireur-waiting')).toBeTruthy());
  expect(buttons.queryByTestId('calibration-offer')).toBeNull();
  expect(buttons.queryByTestId('voice-button')).toBeNull();
});

it('LOCAL: "Calibrer pour ce Tireur" at the start opens the calibration', async () => {
  // Even with a stored calibration: the Tireur on a shared phone may be someone else.
  await AsyncStorage.setItem(VOICE_KEYS.calibration, JSON.stringify({ thresholdMs: 700, shortMedianMs: 300, longMedianMs: 1100, quality: 'good' }));
  const service = new OfflineGameService({ persist: false });
  setGameService(service);
  const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL', settings: { input_mode: 'VOICE' } });
  const screen = await renderWithProviders(<Table sessionId={sessionId} service={service} />);
  await act(async () => {
    fireEvent.press(await screen.findByTestId('pass-ready'));
  });
  await waitFor(() => expect(screen.getByTestId('calibrate-for-tireur')).toBeTruthy());
  await act(async () => {
    fireEvent.press(screen.getByTestId('calibrate-for-tireur'));
  });
  await waitFor(() => expect(screen.getByTestId('calibration-sheet')).toBeTruthy());
  expect(screen.getByTestId('calibration-intro')).toBeTruthy();
});
