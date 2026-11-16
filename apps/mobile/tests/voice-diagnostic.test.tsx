/**
 * Two things that have to be true before anyone can be asked why voice fails:
 * a mangled "oui" is understood (the closed set, `@dsa/voice/answer-match`), and
 * when something does go wrong, the screen says what (« Réglages de la voix →
 * Diagnostic »).
 */
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { TranscribeError } from '@dsa/voice';

import { setVoiceDiagnostic } from '@/speech/voice-settings';
import { activateMic, closeVoiceHarness, resetVoiceHarness, speak, start, transcribe } from './voice-harness';
import { fakeMic } from './fake-recorder';
import { resetFakeMicPermission } from './fake-mic-permission';

jest.mock('@/speech/recorder', () => require('./fake-recorder'));
jest.mock('@/speech/mic-permission', () => require('./fake-mic-permission'));

beforeEach(resetFakeMicPermission);
beforeEach(resetVoiceHarness);
afterEach(closeVoiceHarness);

const DAVID = 'ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[ouioui]/lie-a-david/fils-d-isai--david';

/** A Tireur in front of ANCIEN ?, past the calibration offer. */
async function tireurAtAncien() {
  const game = await start('AI_DECOUVREUR', DAVID);
  const { screen } = game;
  await waitFor(() => expect(screen.getByTestId('calibration-offer')).toBeTruthy());
  await act(async () => {
    fireEvent.press(screen.getByTestId('calibration-offer-later'));
  });
  await waitFor(() => expect(screen.getByTestId('incoming-question-text')).toHaveTextContent(/^ANCIEN/));
  return game;
}

describe('a mangled "oui" still answers', () => {
  // What Whisper writes for a 300 ms French "oui". Before the closed set, every
  // one of these was « Je n'ai pas bien compris » and cost the player a turn.
  for (const heard of ['Hui', 'Hui.', 'Wi', 'Ouh', 'Houi', 'Ouaip']) {
    it(`« ${heard} » answers OUI`, async () => {
      const { service, sessionId, screen } = await tireurAtAncien();
      const answer = jest.spyOn(service, 'answer');
      await speak(screen, 300, heard);
      await waitFor(() => expect(answer).toHaveBeenCalledWith(sessionId, 'OUI'));
    });
  }

  it('« Gestion » rewinds, as "question" does', async () => {
    const { service, screen } = await tireurAtAncien();
    const rewind = jest.spyOn(service, 'rewind');
    // Nothing to undo at the first question: the attempt is refused out loud,
    // but it was read as a rewind rather than as nothing at all.
    await speak(screen, 400, 'Gestion');
    await waitFor(() => expect(screen.getByTestId('voice-notice')).toBeTruthy());
    expect(rewind).not.toHaveBeenCalled();
  });

  it('a name is never an answer, even on the Tireur’s turn', async () => {
    const { service, screen } = await tireurAtAncien();
    const answer = jest.spyOn(service, 'answer');
    await speak(screen, 400, 'Absalom');
    await waitFor(() => expect(screen.getByTestId('voice-notice')).toHaveTextContent(/pas bien compris/));
    expect(answer).not.toHaveBeenCalled();
  });
});

describe('the diagnostic', () => {
  it('is off until it is turned on', async () => {
    const { screen } = await tireurAtAncien();
    await speak(screen, 300, 'Oui');
    expect(screen.queryByTestId('voice-diagnostic')).toBeNull();
  });

  it('tells the whole chain of a turn that worked', async () => {
    const { screen } = await tireurAtAncien();
    await act(async () => {
      setVoiceDiagnostic(true);
    });
    await speak(screen, 300, 'Hui');

    // The microphone, the server, the words, how they were read, and what the
    // game did with them. (A string is matched whole by toHaveTextContent;
    // these are patterns on purpose.)
    const block = await waitFor(() => screen.getByTestId('voice-diagnostic'));
    expect(block).toHaveTextContent(/micro\s+\d+ ms · \d+ mesures · audio\/m4a/);
    expect(block).toHaveTextContent(/serveur\s+groq · \d+ ms/);
    expect(block).toHaveTextContent(/texte\s+« Hui »/);
    expect(block).toHaveTextContent(/lecture\s+OUI · via closed-set/);
    expect(block).toHaveTextContent(/son\s+\d+ ms sur \d+ ms · \d+ salve/);
    expect(block).toHaveTextContent(/jeu\s+ANSWER OUI/);
  });

  it('names the server’s refusal instead of only "réessaie"', async () => {
    const { screen } = await tireurAtAncien();
    await act(async () => {
      setVoiceDiagnostic(true);
    });
    transcribe.mockRejectedValueOnce(
      new TranscribeError('DSA_VOICE_NOT_CONFIGURED', 503, 'La reconnaissance vocale n’est pas encore configurée.'),
    );
    await speak(screen, 300, null);

    await waitFor(() => expect(screen.getByTestId('voice-diagnostic')).toHaveTextContent(/serveur\s+DSA_VOICE_NOT_CONFIGURED/));
  });

  it('says so when the hold was too short to send, and sends nothing', async () => {
    const { screen } = await tireurAtAncien();
    await act(async () => {
      setVoiceDiagnostic(true);
    });
    // A slip of the finger: under MIN_RECORDING_MS. The fake microphone pads
    // half a second of silence either side of `recordingOf`, so this one is
    // built by hand.
    fakeMic.next = {
      audio: { kind: 'file', uri: 'file:///cache/parole.m4a' },
      mimeType: 'audio/m4a',
      fileName: 'parole.m4a',
      durationMs: 120,
      envelope: [],
    };
    await waitFor(() => expect(screen.getByTestId('voice-button-idle')).toBeTruthy());
    await act(async () => {
      activateMic(screen);
    });
    await waitFor(() => expect(screen.getByTestId('voice-button-listening')).toBeTruthy());
    await act(async () => {
      activateMic(screen);
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    await waitFor(() => expect(screen.getByTestId('voice-diagnostic')).toHaveTextContent(/jeu\s+trop court, rien envoyé/));
    expect(transcribe).not.toHaveBeenCalled();
  });
});
