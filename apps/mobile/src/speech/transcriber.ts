/**
 * Speech-to-text for the app: the recording is posted to the Supabase Edge
 * Function `transcribe` (Groq Whisper, Hugging Face fallback — VOICE.md) with the
 * player's own access token. Keys never reach the app.
 *
 * Only the words come from here. Whether a Tireur said OUI or a held "ouiiii" is
 * decided from the recording's loudness envelope (`@dsa/voice` decideAnswer).
 */
import { createTranscribeClient, TranscribeError, type SpeechToText } from '@dsa/voice';

import { ensureSignedIn, getSupabase, isSupabaseConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/services/supabase';
import type { Recording } from './recorder-types';

export type Transcriber = SpeechToText<Recording>;

const unconfigured: Transcriber = {
  available: false,
  async transcribe() {
    throw new TranscribeError(
      'DSA_VOICE_NOT_CONFIGURED',
      503,
      'La reconnaissance vocale n’est pas disponible ici. Joue avec les boutons.',
    );
  },
};

function build(): Transcriber {
  if (!isSupabaseConfigured()) return unconfigured;
  return createTranscribeClient<Recording>({
    supabaseUrl: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    getAccessToken: async () => {
      await ensureSignedIn();
      const { data } = await getSupabase().auth.getSession();
      return data.session?.access_token ?? null;
    },
    fetch: (url, init) => fetch(url, init as RequestInit),
    createFormData: () => new FormData(),
    appendAudio: (form, field, recording) => {
      if (recording.audio.kind === 'blob') {
        form.append(field, recording.audio.blob, recording.fileName);
      } else {
        // React Native's FormData takes a file descriptor object.
        form.append(field, { uri: recording.audio.uri, name: recording.fileName, type: recording.mimeType });
      }
    },
  });
}

let transcriber: Transcriber | null = null;

export function getTranscriber(): Transcriber {
  if (!transcriber) transcriber = build();
  return transcriber;
}

/** Test seam. */
export function setTranscriber(next: Transcriber | null): void {
  transcriber = next;
}
