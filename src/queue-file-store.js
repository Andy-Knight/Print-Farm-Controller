// Backward-compatible queue-file API.
//
// v0.15.0 promotes controller-staged files into the persistent Print Library.
// Existing queue/history records still refer to stagedFile.id, so these aliases
// deliberately preserve the previous module contract while changing lifecycle
// ownership from queue cleanup to explicit library management.
export {
  addLibraryFile as stageQueueFile,
  getLibraryFile as getQueueFile,
  removeLibraryFile as removeQueueFile,
  preserveLibraryFiles as pruneQueueFiles,
  printLibraryPath as queueFilesPath
} from './print-library.js';
