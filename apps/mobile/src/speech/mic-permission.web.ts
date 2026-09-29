/**
 * The microphone permission in a browser.
 *
 * `getUserMedia` is the only way to raise the dialog, so "ask again" is a real
 * `getUserMedia` call — made from the player's tap, which is what the browsers
 * require. What the Permissions API says *after* a refusal is what tells the two
 * refusals apart: `prompt` (nothing stored — the next tap asks again) from
 * `denied` (stored for the site — no dialog will come, so the app shows where the
 * switch is instead). Safari answers neither, which reads here as `unknown`: the
 * app asks anyway, and falls back to the instructions if that gets nowhere.
 */
import type { MicHelpKind, MicPermissionPort, MicPermissionState } from './mic-permission-types';

export * from './mic-permission-types';

/** Not in every lib.dom version, and not in every browser: queried by name. */
const MICROPHONE = 'microphone' as PermissionName;

type PermissionsApi = { query: (descriptor: { name: PermissionName }) => Promise<PermissionStatus> };

function permissionsApi(): PermissionsApi | null {
  const api = (typeof navigator === 'undefined' ? null : navigator)?.permissions as PermissionsApi | undefined;
  return typeof api?.query === 'function' ? api : null;
}

function media(): MediaDevices | null {
  const devices = (typeof navigator === 'undefined' ? null : navigator)?.mediaDevices;
  return typeof devices?.getUserMedia === 'function' ? devices : null;
}

async function queryStatus(): Promise<PermissionStatus | null> {
  const api = permissionsApi();
  if (!api) return null;
  try {
    return await api.query({ name: MICROPHONE });
  } catch {
    // Firefox before 132 and every Safari throw on an unknown permission name.
    return null;
  }
}

function stateOf(status: PermissionStatus | null): MicPermissionState {
  if (!status) return 'unknown';
  return status.state === 'granted' || status.state === 'denied' ? status.state : 'prompt';
}

async function read(): Promise<MicPermissionState> {
  return stateOf(await queryStatus());
}

function isRefusal(caught: unknown): boolean {
  const name = (caught as { name?: string } | null)?.name;
  return name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError';
}

async function request(): Promise<MicPermissionState> {
  const devices = media();
  if (!devices) return 'unknown';
  // Already allowed: there is nothing to ask. Calling getUserMedia anyway would
  // open the microphone — and light the browser's "mic in use" dot — to learn
  // what the browser has just said, so the question is not asked twice.
  if ((await read()) === 'granted') return 'granted';
  try {
    const stream = await devices.getUserMedia({ audio: true });
    // Only the answer was wanted: the recorder opens the microphone for itself.
    stream.getTracks().forEach((track) => track.stop());
    return 'granted';
  } catch (caught) {
    if (!isRefusal(caught)) return 'unknown'; // No microphone, or a failure that is not a refusal.
    const after = await read();
    if (after === 'granted') return 'granted';
    // `prompt`: the refusal was not stored, so the next tap raises the dialog
    // again. `unknown` (Safari): treated as stored, which is the safe guess —
    // the player is shown the instructions and can still tap Réessayer.
    return after === 'prompt' ? 'prompt' : 'denied';
  }
}

function watch(listener: (state: MicPermissionState) => void): () => void {
  let stopped = false;
  let unwatch = () => undefined as void;

  void (async () => {
    const status = await queryStatus();
    if (stopped || !status) return;
    const onChange = () => listener(stateOf(status));
    if (typeof status.addEventListener === 'function') {
      status.addEventListener('change', onChange);
      unwatch = () => status.removeEventListener('change', onChange);
    } else {
      status.onchange = onChange;
      unwatch = () => {
        status.onchange = null;
      };
    }
  })();

  // Safari has no microphone permission to watch, and a player who changes the
  // setting does it in another window or panel: reading again when the page comes
  // back catches what no event announced.
  const recheck = () => {
    void read().then((state) => {
      if (!stopped) listener(state);
    });
  };
  const doc = typeof document === 'undefined' ? null : document;
  const win = typeof window === 'undefined' ? null : window;
  const onVisible = () => {
    if (!doc || doc.visibilityState === 'visible') recheck();
  };
  doc?.addEventListener?.('visibilitychange', onVisible);
  win?.addEventListener?.('focus', onVisible);

  return () => {
    stopped = true;
    unwatch();
    doc?.removeEventListener?.('visibilitychange', onVisible);
    win?.removeEventListener?.('focus', onVisible);
  };
}

/** Where the switch is depends on the browser, so the instructions do too. */
function helpKind(): MicHelpKind {
  const ua = (typeof navigator === 'undefined' ? '' : navigator.userAgent) || '';
  // Every browser on iOS is Safari underneath, and the switch is in the phone's
  // own settings there — not in the page.
  if (/iPhone|iPad|iPod|CriOS|FxiOS/i.test(ua)) return 'iosBrowser';
  if (/Android/i.test(ua)) return 'androidBrowser';
  if (/Firefox/i.test(ua)) return 'firefox';
  if (/Edg|Chrome|Chromium|OPR|Brave/i.test(ua)) return 'chromium';
  if (/Safari/i.test(ua)) return 'safari';
  return 'generic';
}

export const micPermission: MicPermissionPort = {
  get available() {
    return media() !== null;
  },
  read,
  request,
  watch,
  helpKind,
};
