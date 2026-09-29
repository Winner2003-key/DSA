/**
 * The microphone permission as a thing the app can ask for again.
 *
 * Recording (`recorder.web.ts`, `recorder.native.ts`) only ever reports that it
 * was refused; this port is what turns a refusal into a way back in. It matters
 * most in a browser: a player who clicked "Bloquer" without reading gets no
 * second dialog from `getUserMedia`, because the browser has stored the refusal
 * for the site. So the app has to
 *
 *  - ask again on every try (a refusal the browser did *not* store — Firefox
 *    without "Retenir cette décision", a dismissed dialog, Safari — asks again
 *    straight away, and that alone brings most players back);
 *  - say where the switch is when the refusal *was* stored, since no amount of
 *    JavaScript can reopen that dialog;
 *  - notice by itself when the player flips the switch, so the game goes on
 *    without a reload.
 */

/**
 * `prompt` means the platform will show its dialog when asked (nothing stored),
 * `denied` that a refusal is stored and asking shows nothing, `unknown` that the
 * platform will not say (Safari has no microphone permission to query) — asking
 * is still worth a try.
 */
export type MicPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * Which set of instructions to show when the refusal is stored. The port names
 * the platform; the French text lives with the rest of the French (`i18n/fr`).
 */
export type MicHelpKind = 'chromium' | 'firefox' | 'safari' | 'androidBrowser' | 'iosBrowser' | 'phone' | 'generic';

export interface MicPermissionPort {
  /** False when nothing here can record at all (no getUserMedia, no secure context). */
  readonly available: boolean;
  /** The stored decision, without asking the player anything. */
  read(): Promise<MicPermissionState>;
  /**
   * Asks again — the platform's own dialog when there can still be one. The
   * state it resolves to is the state after the attempt, so `denied` means the
   * platform refused without asking anybody.
   */
  request(): Promise<MicPermissionState>;
  /** Calls back when the decision changes outside the app (the site settings). */
  watch(listener: (state: MicPermissionState) => void): () => void;
  /** Which instructions fit this platform. */
  helpKind(): MicHelpKind;
  /** Opens the platform's own settings page, where there is one to open (phones). */
  openSettings?: () => void;
}
