// expo/metro-config already detects the npm workspace root and adds the repo
// root to `watchFolders` plus `node_modules` to `nodeModulesPaths`, which is what
// lets Metro bundle `@dsa/core` straight from packages/core/src. Verified with
// `npx expo export -p web`; keep this file as the place to record that.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
