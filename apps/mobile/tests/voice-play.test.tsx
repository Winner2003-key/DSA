/**
 * Voice in a game (brief S7b): the real GameTable, useGame and offline service,
 * with a scripted microphone and a mocked `transcribe`.
 */
import * as Speech from 'expo-speech';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { TranscribeError } from '@dsa/voice';

import { fakeMic, recordingOf } from './fake-recorder';
import { CAIN, closeVoiceHarness, DAVID, EST_CE, resetVoiceHarness, said, speak, spoken, start, transcribe } from './voice-harness';
import { makeSettings, makeState, renderWithProviders } from './helpers';
import { TireurVoice } from '@/views/voice-play';
import type { GameState } from '@/services/types';
import type { Countdown } from '@/state/use-countdown';
import type { UseGame } from '@/state/use-game';
import { setTalkMode } from '@/speech/voice-settings';

jest.mock('@/speech/recorder', () => require('./fake-recorder'));

beforeEach(resetVoiceHarness);
afterEach(closeVoiceHarness);

describe('Découvreur by voice (AI Tireur)', () => {
  it('"Ancien" asks, and the answer is spoken', async () => {
    const { service, sessionId, screen } = await start('AI_TIREUR', CAIN);
    const ask = jest.spyOn(service, 'ask');
    await waitFor(() => expect(screen.getByTestId('prompt-text')).toHaveTextContent(/^ANCIEN\s\?$/));

    await speak(screen, 500, 'Ancien ?');
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('prompt-text')).toHaveTextContent(/^HOMME\s\?$/));
    expect(screen.getByTestId('voice-heard')).toHaveTextContent('J’ai entendu : « Ancien »');
    expect(spoken()).toContain('Oui.');
    // With Voix the phone answers; the Découvreur says the next question.
    expect(spoken().some((text) => text.includes('Homme'))).toBe(false);
    // TTS was stopped before recording, and the hint carried the question.
    expect(Speech.stop).toHaveBeenCalled();
    expect(transcribe.mock.calls[0]?.[1]).toMatchObject({ hint: expect.stringContaining('Ancien ?'), durationMs: expect.any(Number) });
    // The buttons are still there.
    expect(screen.getByTestId('ask-button')).toBeTruthy();
  });

  it('noise gives "Je n’ai pas bien compris. Peux-tu répéter ?", shown and spoken', async () => {
    const { service, screen } = await start('AI_TIREUR', CAIN);
    const ask = jest.spyOn(service, 'ask');
    await waitFor(() => expect(screen.getByTestId('prompt-text')).toBeTruthy());

    await speak(screen, 400, '...');
    await waitFor(() => expect(screen.getByTestId('voice-notice')).toHaveTextContent('Je n’ai pas bien compris. Peux-tu répéter ?'));
    expect(spoken()).toContain('Je n’ai pas bien compris. Peux-tu répéter ?');
    expect(ask).not.toHaveBeenCalled();
  });

  it('calls a name, then goes back by voice', async () => {
    const { service, sessionId, screen } = await start('AI_TIREUR', CAIN);
    await waitFor(() => expect(screen.getByTestId('prompt-text')).toBeTruthy());
    const guess = jest.spyOn(service, 'guess');
    const goBack = jest.spyOn(service, 'goBack');

    for (const text of ['Ancien', 'Homme', 'Pentateuque']) {
      await speak(screen, 500, text);
      await waitFor(() => expect(screen.getByTestId('exchange-latest')).toHaveTextContent(new RegExp(text.toUpperCase())));
    }

    await speak(screen, 600, 'Abram !');
    await waitFor(() => expect(guess).toHaveBeenCalledWith(sessionId, 'ABRAM'));
    await waitFor(() => expect(screen.getByTestId('exchange-latest')).toHaveTextContent(/ABRAM/));

    await speak(screen, 900, 'Revenir à Homme.');
    await waitFor(() => expect(goBack).toHaveBeenCalledWith(sessionId, 1));
    await waitFor(() => expect(screen.getByTestId('prompt-text')).toHaveTextContent(/^HOMME\s\?$/));
  });

  it('holds to talk by default: press, speak, release', async () => {
    setTalkMode('HOLD');
    const { service, screen } = await start('AI_TIREUR', CAIN);
    const ask = jest.spyOn(service, 'ask');
    await waitFor(() => expect(screen.getByTestId('voice-button-label')).toHaveTextContent('Maintiens le bouton et parle'));

    fakeMic.next = recordingOf(500);
    said('Ancien');
    await act(async () => {
      fireEvent(screen.getByTestId('voice-button'), 'pressIn');
    });
    await waitFor(() => expect(screen.getByTestId('voice-level')).toBeTruthy());
    // The recording keeps a short tail (400 ms) after release, then goes to the server.
    await act(async () => {
      fireEvent(screen.getByTestId('voice-button'), 'pressOut');
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(fakeMic.stops).toBe(0);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(fakeMic.stops).toBe(1);
  });
});

describe('Tireur by voice (AI Découvreur)', () => {
  /** Answers ANCIEN and HOMME with the buttons, up to PENTATEUQUE (NON / NONONONON). */
  async function atPentateuque() {
    const game = await start('AI_DECOUVREUR', DAVID);
    const { screen } = game;
    await waitFor(() => expect(screen.getByTestId('calibration-offer')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId('calibration-offer-later'));
    });
    for (const question of ['ANCIEN', 'HOMME']) {
      await waitFor(() => expect(screen.getByTestId('incoming-question-text')).toHaveTextContent(new RegExp(`^${question}`)));
      await act(async () => {
        fireEvent.press(screen.getByTestId('answer-OUI'));
      });
    }
    await waitFor(() => expect(screen.getByTestId('incoming-question-text')).toHaveTextContent(/^PENTATEUQUE/));
    return game;
  }

  it('speaks the question directly, and a long "non" answers NONONONON', async () => {
    const { service, sessionId, screen } = await atPentateuque();
    const answer = jest.spyOn(service, 'answer');
    await waitFor(() => expect(spoken()).toContain('Pentateuque ?'));
    expect(spoken().filter((text) => EST_CE.test(text))).toEqual([]);

    await speak(screen, 1300, 'Non.');
    await waitFor(() => expect(answer).toHaveBeenCalledWith(sessionId, 'NONONONON'));
    await waitFor(() => expect(screen.getByTestId('incoming-question-text')).toHaveTextContent(/^LIVRE DE SAMUEL/));
    // The answer buttons never left.
    expect(screen.getByTestId('answer-pad')).toBeTruthy();
  });

  it('a short "non" answers NON', async () => {
    const { service, sessionId, screen } = await atPentateuque();
    const answer = jest.spyOn(service, 'answer');
    await speak(screen, 300, 'Non');
    await waitFor(() => expect(answer).toHaveBeenCalledWith(sessionId, 'NON'));
  });

  it('a borderline sound shows the two confirm buttons, one tap answers', async () => {
    const { service, sessionId, screen } = await atPentateuque();
    const answer = jest.spyOn(service, 'answer');
    await speak(screen, 650, 'Non');
    await waitFor(() => expect(screen.getByTestId('voice-confirm')).toBeTruthy());
    expect(answer).not.toHaveBeenCalled();
    expect(screen.getByTestId('voice-confirm-NON')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('voice-confirm-NON_REPETE'));
    });
    await waitFor(() => expect(answer).toHaveBeenCalledWith(sessionId, 'NONONONON'));
    await waitFor(() => expect(screen.queryByTestId('voice-confirm')).toBeNull());
  });

  it('"question question" rewinds two questions', async () => {
    const { service, sessionId, screen } = await atPentateuque();
    const rewind = jest.spyOn(service, 'rewind');
    await speak(screen, 900, 'Question, question.');
    await waitFor(() => expect(rewind).toHaveBeenCalledWith(sessionId, 2));
    await waitFor(() => expect(screen.getByTestId('incoming-question-text')).toHaveTextContent(/^ANCIEN/));
  });
});

describe('fallbacks: the game continues with the buttons', () => {
  it('permission denied: a French banner, no mic, buttons work, no crash', async () => {
    const { service, sessionId, screen } = await start('AI_TIREUR', CAIN);
    await waitFor(() => expect(screen.getByTestId('prompt-text')).toBeTruthy());
    fakeMic.error = 'PERMISSION_DENIED';
    await act(async () => {
      fireEvent.press(screen.getByTestId('voice-button'));
    });
    await waitFor(() => expect(screen.getByTestId('voice-fallback')).toHaveTextContent(/Le micro est refusé/));
    expect(screen.queryByTestId('voice-button')).toBeNull();
    expect(transcribe).not.toHaveBeenCalled();

    const ask = jest.spyOn(service, 'ask');
    await act(async () => {
      fireEvent.press(screen.getByTestId('ask-button'));
    });
    await waitFor(() => expect(ask).toHaveBeenCalledWith(sessionId));
    await waitFor(() => expect(screen.getByTestId('prompt-text')).toHaveTextContent(/^HOMME/));
  });

  it('rate limited or unreachable: the server’s French message, the mic stays for a retry', async () => {
    const { screen } = await start('AI_TIREUR', CAIN);
    await waitFor(() => expect(screen.getByTestId('prompt-text')).toBeTruthy());

    transcribe.mockRejectedValueOnce(
      new TranscribeError('DSA_VOICE_RATE_LIMIT', 429, 'Trop de demandes vocales. Réessaie dans quelques minutes, ou utilise les boutons.', 60),
    );
    await speak(screen, 500, null);
    await waitFor(() => expect(screen.getByTestId('voice-fallback')).toHaveTextContent(/Trop de demandes vocales/));
    expect(screen.getByTestId('voice-button')).toBeTruthy();
    expect(screen.getByTestId('ask-button')).toBeTruthy();

    transcribe.mockRejectedValueOnce(new TranscribeError('DSA_VOICE_NETWORK', 0, 'Pas de connexion au serveur vocal.'));
    await speak(screen, 500, null);
    await waitFor(() => expect(screen.getByTestId('voice-fallback')).toHaveTextContent(/Pas de connexion au serveur vocal/));
    await act(async () => {
      fireEvent.press(screen.getByTestId('voice-fallback-close'));
    });
    expect(screen.queryByTestId('voice-fallback')).toBeNull();
  });

  it('the mic is only active on your turn', async () => {
    // The AI Découvreur takes a long time to ask: the Tireur's mic stays off meanwhile.
    const { screen } = await start('AI_DECOUVREUR', DAVID, 60_000);
    await waitFor(() => expect(screen.getByTestId('voice-button-disabled')).toBeTruthy());
    expect(screen.getByTestId('voice-button-label')).toHaveTextContent('Le micro s’allume à ton tour.');
    await act(async () => {
      fireEvent.press(screen.getByTestId('voice-button'));
    });
    expect(fakeMic.starts).toBe(0);
  });
});

describe('the chronometer and the microphone (§9)', () => {
  /** A `UseGame` good enough for `TireurVoice`, with the answer pad waiting. */
  function tireurGame(over: Partial<GameState>, countdown: Countdown): UseGame {
    const state = makeState({
      mode: 'AI_DECOUVREUR',
      awaiting: 'ANSWER',
      timed: true,
      settings: makeSettings({ input_mode: 'VOICE', timed: true, think_seconds: 40, play_seconds: 120 }),
      ...over,
    });
    return {
      state,
      loading: false,
      busy: false,
      error: null,
      clearError: () => undefined,
      myRoles: ['TIREUR'],
      isLocal: false,
      activeRole: 'TIREUR',
      aiThinking: false,
      outgoing: null,
      refusedGuess: null,
      exchanges: [],
      phase: state.status === 'PLAYING' ? 'PLAYING' : 'ENDED',
      confirmTireurReady: () => undefined,
      redrawSecret: async () => undefined,
      canRedraw: false,
      countdown,
      clockPhase: 'PLAYING',
      otherRedrew: false,
      rewoundTo: null,
      isRoom: false,
      realtimeStatus: null,
      connectionLost: false,
      refresh: async () => undefined,
      ask: async () => undefined,
      answer: async () => undefined,
      guess: async () => undefined,
      confirmGuess: async () => undefined,
      goBack: async () => undefined,
      rewind: async () => undefined,
      abandon: async () => undefined,
    };
  }

  const RUNNING: Countdown = { running: true, msLeft: 30_000, secondsLeft: 30, fraction: 0.25, level: 'WARNING' };
  const UP: Countdown = { running: true, msLeft: 0, secondsLeft: 0, fraction: 0, level: 'UP' };

  it('drops a recording that was still running when the countdown reached zero', async () => {
    const screen = await renderWithProviders(<TireurVoice game={tireurGame({}, RUNNING)} />);

    fakeMic.next = recordingOf(600);
    said('oui');
    await waitFor(() => expect(screen.getByTestId('voice-button-idle')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId('voice-button'));
    });
    await waitFor(() => expect(screen.getByTestId('voice-button-listening')).toBeTruthy());

    // Zero. The mic closes at once, without waiting for the server to confirm.
    await act(async () => {
      screen.rerender(<TireurVoice game={tireurGame({}, UP)} />);
    });
    await waitFor(() => expect(screen.queryByTestId('voice-button-listening')).toBeNull());
    expect(fakeMic.cancels).toBe(1);
    expect(fakeMic.stops).toBe(0);
    // Nothing was sent to be transcribed: a word said after the limit must not count.
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('drops it just the same when TIME_UP arrives from the server', async () => {
    const screen = await renderWithProviders(<TireurVoice game={tireurGame({}, RUNNING)} />);

    fakeMic.next = recordingOf(600);
    said('oui');
    await waitFor(() => expect(screen.getByTestId('voice-button-idle')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId('voice-button'));
    });
    await waitFor(() => expect(screen.getByTestId('voice-button-listening')).toBeTruthy());

    await act(async () => {
      screen.rerender(<TireurVoice game={tireurGame({ status: 'TIME_UP', awaiting: 'NONE' }, RUNNING)} />);
    });
    await waitFor(() => expect(screen.queryByTestId('voice-button-listening')).toBeNull());
    expect(fakeMic.cancels).toBe(1);
    expect(transcribe).not.toHaveBeenCalled();
  });
});
