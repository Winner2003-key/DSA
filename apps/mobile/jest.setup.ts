// Silences Reanimated's dev warnings and provides the browser-ish globals the
// web TTS path looks for. The tests never actually speak.
jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(),
  isSpeakingAsync: jest.fn(async () => false),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// React 19 only enables act() when the environment opts in.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The QR scanner's camera is native; tests never open it.
jest.mock('expo-camera', () => ({
  CameraView: Object.assign(() => null, { isAvailableAsync: jest.fn(async () => false) }),
  useCameraPermissions: () => [{ granted: false, canAskAgain: true }, jest.fn(async () => ({ granted: true }))],
}));

// expo-audio is native. The voice tests replace `@/speech/recorder` with a fake;
// this only keeps screens that mount the real recorder hook from crashing.
jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100, numberOfChannels: 2, bitRate: 128000 } },
  useAudioRecorder: () => ({
    prepareToRecordAsync: jest.fn(async () => undefined),
    record: jest.fn(),
    stop: jest.fn(async () => undefined),
    getStatus: () => ({ isRecording: false, durationMillis: 0, canRecord: true, mediaServicesDidReset: false, url: null }),
    uri: null,
    currentTime: 0,
  }),
  getRecordingPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true, status: 'undetermined' })),
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: false, status: 'denied' })),
  setAudioModeAsync: jest.fn(async () => undefined),
}));
