import { Platform } from 'react-native';
import * as Speech from 'expo-speech';

export interface SpeakOptions {
  /** Slower for names and answers, so they are heard across a table. */
  rate?: number;
  pitch?: number;
}

/**
 * Reads French out loud. The game is spoken, so this is a primary channel, not a
 * decoration: the answer must be heard by a player who does not read.
 *
 * `expo-speech` on native (works in Expo Go), `speechSynthesis` on the web.
 * Speech-to-text is a separate interface, implemented in S7 (`./stt`).
 */
export interface TextToSpeech {
  readonly available: boolean;
  speak(text: string, options?: SpeakOptions): Promise<void>;
  stop(): void;
}

const LANGUAGE = 'fr-FR';

class NativeTts implements TextToSpeech {
  readonly available = true;

  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    if (text.trim() === '') return;
    Speech.stop();
    await new Promise<void>((resolve) => {
      Speech.speak(text, {
        language: LANGUAGE,
        rate: options.rate ?? 0.95,
        pitch: options.pitch ?? 1,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: () => resolve(),
      });
    });
  }

  stop(): void {
    Speech.stop();
  }
}

interface WebSpeechWindow {
  speechSynthesis?: {
    speak(utterance: unknown): void;
    cancel(): void;
    getVoices(): { lang: string; name: string }[];
  };
  SpeechSynthesisUtterance?: new (text: string) => {
    lang: string;
    rate: number;
    pitch: number;
    voice?: unknown;
    onend: (() => void) | null;
    onerror: (() => void) | null;
  };
}

class WebTts implements TextToSpeech {
  private get win(): WebSpeechWindow | null {
    return typeof globalThis === 'undefined' ? null : (globalThis as unknown as WebSpeechWindow);
  }

  get available(): boolean {
    const win = this.win;
    return Boolean(win?.speechSynthesis && win?.SpeechSynthesisUtterance);
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const win = this.win;
    if (!this.available || !win?.speechSynthesis || !win.SpeechSynthesisUtterance || text.trim() === '') return;
    win.speechSynthesis.cancel();
    await new Promise<void>((resolve) => {
      const utterance = new win.SpeechSynthesisUtterance!(text);
      utterance.lang = LANGUAGE;
      utterance.rate = options.rate ?? 0.95;
      utterance.pitch = options.pitch ?? 1;
      const french = win.speechSynthesis?.getVoices().find((v) => v.lang.toLowerCase().startsWith('fr'));
      if (french) utterance.voice = french;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      win.speechSynthesis?.speak(utterance);
      // Some browsers never fire onend for short strings; don't block the UI.
      setTimeout(resolve, 6000);
    });
  }

  stop(): void {
    this.win?.speechSynthesis?.cancel();
  }
}

class SilentTts implements TextToSpeech {
  readonly available = false;
  async speak(): Promise<void> {}
  stop(): void {}
}

function build(): TextToSpeech {
  if (Platform.OS === 'web') {
    const web = new WebTts();
    return web.available ? web : new SilentTts();
  }
  return new NativeTts();
}

export const textToSpeech: TextToSpeech = build();
