/** Shared by the voice game tests: a real table on the offline service, a fake mic, a mocked transcribe. */
import React from 'react';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import type { GameMode } from '@dsa/core';
import type { TranscribeResult } from '@dsa/voice';

import { setGameService } from '@/services';
import { OfflineGameService } from '@/services/offline-game-service';
import { setTranscriber } from '@/speech/transcriber';
import { resetVoiceSettingsForTests, setTalkMode } from '@/speech/voice-settings';
import { clearNameCacheForTests } from '@/state/use-names';
import { useGame } from '@/state/use-game';
import { GameTable } from '@/views/game-table';

import { fakeMic, recordingOf, resetFakeMic } from './fake-recorder';
import { renderWithProviders } from './helpers';

export const CAIN = 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/le-meurtrier--cain';
export const DAVID = 'ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[ouioui]/lie-a-david/fils-d-isai--david';
export const EST_CE = /est[\s-]*ce/i;

export const transcribe = jest.fn<Promise<TranscribeResult>, [unknown, unknown]>();
export const said = (text: string) => transcribe.mockResolvedValueOnce({ text, provider: 'groq', durationMs: 1200 });
export const spoken = () => (Speech.speak as jest.Mock).mock.calls.map((call) => String(call[0]));

function Table({ sessionId, service, aiThinkingMs = 0 }: { sessionId: string; service: OfflineGameService; aiThinkingMs?: number }) {
  const game = useGame(sessionId, { service, aiAnswerBeatMs: 0, aiThinkingMs });
  return <GameTable sessionId={sessionId} game={game} />;
}

export interface StartOptions {
  aiThinkingMs?: number;
  /** §9: play with the chronometer. */
  timed?: boolean;
  /** §9: the clock the timer runs on, so a test can stand at any second. */
  now?: () => string;
}

export async function start(mode: GameMode, secretNodeKey: string, options: number | StartOptions = 0) {
  const { aiThinkingMs = 0, timed = false, now } = typeof options === 'number' ? { aiThinkingMs: options } : options;
  const service = new OfflineGameService({ persist: false, secretNodeKey, ...(now ? { now } : {}) });
  setGameService(service);
  const { sessionId } = await service.createSession({
    graphSlug: 'mini',
    mode,
    settings: { input_mode: 'VOICE', timed },
  });
  // §9: the preparation phase is not what these tests are about; end it first.
  if (mode !== 'AI_TIREUR') await service.tireurReady(sessionId);
  const screen = await renderWithProviders(<Table sessionId={sessionId} service={service} aiThinkingMs={aiThinkingMs} />);
  return { service, sessionId, screen };
}

export type Screen = Awaited<ReturnType<typeof start>>['screen'];

/** "Parler librement": one tap starts, a second tap stops (the fake mic sends no levels). */
export async function speak(screen: Screen, voiceMs: number, text: string | null) {
  fakeMic.next = recordingOf(voiceMs);
  if (text !== null) said(text);
  await waitFor(() => expect(screen.getByTestId('voice-button-idle')).toBeTruthy());
  await act(async () => {
    fireEvent.press(screen.getByTestId('voice-button'));
  });
  await waitFor(() => expect(screen.getByTestId('voice-button-listening')).toBeTruthy());
  // Stop, transcribe, act on the game: all mocked and quick, but chained over several
  // ticks — keep them inside act() so every state update is accounted for.
  await act(async () => {
    fireEvent.press(screen.getByTestId('voice-button'));
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

/** Call from beforeEach / afterEach. */
export async function resetVoiceHarness() {
  await AsyncStorage.clear();
  resetFakeMic();
  resetVoiceSettingsForTests();
  clearNameCacheForTests();
  (Speech.speak as jest.Mock).mockClear();
  (Speech.stop as jest.Mock).mockClear();
  transcribe.mockReset();
  setTranscriber({ available: true, transcribe: transcribe as never });
  setTalkMode('FREE');
}

export async function closeVoiceHarness() {
  // Let the last AI move and its speech effects settle inside act() before unmounting.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  setTranscriber(null);
  setGameService(null);
}
