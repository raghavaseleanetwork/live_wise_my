const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

/**
 * Keep server-only packages out of Metro's file watcher.
 *
 * `firebase-admin` pulls in `@google-cloud/*`, which is Node-server code that
 * never enters the mobile bundle. Metro still walks those directories on
 * startup, and one of them (`@google-cloud/firestore/build/src/v1`) is
 * unreadable on this machine — `scandir` returns `UNKNOWN` (errno -4094), which
 * the watcher escalates to a fatal `error` event that kills `expo start`
 * outright rather than skipping the folder.
 *
 * Excluding it costs nothing (no mobile code imports it) and removes a hard
 * startup failure. Metro's warning explicitly recommends this remedy.
 */
config.resolver.blockList = [
  /node_modules[\\/]@google-cloud[\\/].*/,
  /node_modules[\\/]firebase-admin[\\/].*/,
];

module.exports = config;
