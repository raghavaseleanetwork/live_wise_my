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
  /node_modules[\\/]path-scurry[\\/]node_modules[\\/]lru-cache[\\/].*/,
  // npm's scratch directories are named `.path-scurry-<random>` — note the
  // leading dot, which the pattern above does not match. One of these was left
  // behind by an interrupted install and is now unreadable at the filesystem
  // level (`scandir` -> UNKNOWN, errno -4094), which the watcher escalates to a
  // fatal error that kills `expo start`. The suffix is random, so match the
  // prefix rather than a specific directory name.
  /node_modules[\\/]\.path-scurry-.*/,
  // Gradle's Kotlin incremental-compile caches. Build output, never bundled,
  // and the same `scandir` UNKNOWN error surfaced here too.
  /node_modules[\\/]expo[\\/]android[\\/]build[\\/].*/,
];

module.exports = config;
