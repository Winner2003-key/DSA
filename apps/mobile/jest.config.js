module.exports = {
  preset: 'jest-expo',
  // react-native-worklets ships .native.ts entry points that cannot run under Jest.
  resolver: 'react-native-worklets/jest/resolver.js',
  // lucide's react-native entry is an .mjs file Jest does not transform; use its CommonJS build.
  moduleNameMapper: { '^lucide-react-native$': require('path').join(require.resolve('lucide-react-native'), '../../cjs/lucide-react-native.js') },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/.expo/'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', 'app/**/*.tsx'],
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@supabase|@dsa|uuid))',
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
  ],
};
