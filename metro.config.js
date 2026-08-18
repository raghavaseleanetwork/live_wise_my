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
  // Old, filesystem-corrupted `node_modules` trees renamed aside during
  // reinstalls (e.g. `node_modules_stale_<timestamp>`,
  // `node_modules_broken_delete_me`). They cannot be deleted (NTFS corruption
  // -- needs chkdsk), and their unreadable entries raise the same fatal
  // `scandir` UNKNOWN described below. Nothing here is bundled; these trees
  // are dead weight awaiting removal once chkdsk repairs the disk.
  /node_modules_(stale|broken_delete_me)[^\\/]*[\\/].*/,
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
  // npm renames a package aside as `.<name>-<random>` while replacing it. When
  // the original is filesystem-corrupted the rename succeeds but the delete
  // does not, leaving an unreadable orphan that raises the same fatal `scandir`
  // UNKNOWN. `.react-native-screens-sVArmPBt` was left this way; the pattern is
  // generic because the name is random and this recurs on this machine.
  /node_modules[\\/]\.[^\\/]+-[A-Za-z0-9]{8}[\\/].*/,
  // AWS SDK TypeScript declarations pulled in by the S3 client. `dist-types` is
  // .d.ts only — never bundled — and one directory under it is corrupted on
  // this machine with the same `scandir` UNKNOWN.
  /node_modules[\\/]@smithy[\\/].*[\\/]dist-types[\\/].*/,
  // Gradle's Kotlin incremental-compile caches. Build output, never bundled,
  // and the same `scandir` UNKNOWN error surfaced here too.
  /node_modules[\\/]expo[\\/]android[\\/]build[\\/].*/,
  // Every native module's Gradle output, not just expo's.
  // `npx expo run:android` writes these while Metro is already watching,
  // and Metro dies on them with the same fatal `scandir` UNKNOWN (seen under
  // `@react-native-community/datetimepicker` and `expo-modules-core`).
  /node_modules[\\/].*[\\/]android[\\/]build[\\/].*/,
];

/**
 * `blockList` governs resolution, not crawling -- the file watcher still walks
 * these directories and dies on the unreadable ones before resolution is ever
 * reached, so the crawler needs its own ignore pattern.
 */
config.watcher = {
  ...config.watcher,
  ignore: [
    /node_modules_(stale|broken_delete_me)[^\\/]*[\\/]/,
    // Same orphans as in `blockList` above. This entry is the one that actually
    // prevents the crash: the crawler reaches these directories before
    // resolution, so blocking resolution alone is not enough.
    /node_modules[\\/]\.[^\\/]+-[A-Za-z0-9]{8}[\\/]/,
    /node_modules[\\/]\.path-scurry-/,
    /node_modules[\\/]@smithy[\\/]/,
    // --- Android build output --------------------------------------------
    //
    // `npx expo run:android` runs Metro and Gradle over the same tree.
    // Gradle creates, rewrites and deletes these directories *while* Metro is
    // crawling them, so a scandir lands on one that has just been removed and
    // returns UNKNOWN (errno -4094) -- which the watcher escalates to a fatal
    // error, killing the bundler seconds after a successful build.
    //
    // None of it is bundled: `.cxx` is CMake/NDK scratch, `build/` is Gradle
    // output, `.gradle/` is Gradle's cache.
    /android[\\/]app[\\/]\.cxx/,
    // The NTFS-corrupted `.cxx` tree, renamed aside because it cannot be
    // deleted ("corrupted and unreadable" — needs chkdsk). Renaming succeeded
    // where every delete failed, which is enough: Gradle now writes native
    // scratch to `android/build/native-staging` (see android/app/build.gradle)
    // and nothing walks this orphan. Delete it once chkdsk repairs the disk.
    /android[\\/]app[\\/]\.cxx_corrupt_delete_after_chkdsk/,
    /android[\\/].*build[\\/]/,
    /android[\\/]\.gradle[\\/]/,
    /node_modules[\\/].*[\\/]android[\\/]build[\\/]/,
  ],
};

module.exports = config;
