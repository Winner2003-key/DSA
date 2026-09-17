/**
 * Voice in a game (brief S7b): the real GameTable, useGame and offline service,
 * with a scripted microphone and a mocked `transcribe`.
 */
import * as Speech from 'expo-speech';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { TranscribeError } from '@dsa/voice';

import { fakeMic, recordingOf } from './fake-recorder';
import { CAIN, closeVoiceHarness, DAVID, EST_CE, resetVoiceHarness, said, speak, spoken, start, transcribe } from './voice-harness';
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
