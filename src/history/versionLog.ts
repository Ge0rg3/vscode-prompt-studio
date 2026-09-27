// Reads a note's `git log --raw -z` output into its past versions

// One stored version of a note
export interface NoteVersion {
  blobId: string;
  savedAt: number;
  // The note's path in the vault back then, set only when it has moved since
  formerPath?: string;
}

// One commit from a note's log
interface LoggedVersion {
  blobId: string;
  savedAt: number;
  pathInVault: string;
}

// Start each commit's record with an ASCII record separator to split the log on
export const LOG_FORMAT = '--format=%x1e%ct';
const RECORD_SEPARATOR = '\x1e';

// A blob id of all zeros marks the commit that deleted the note
const DELETED_BLOB = /^0+$/;

// Read the log into one entry per commit, skipping the commit that deleted the note
function parseLog(output: string): LoggedVersion[] {
  const logged: LoggedVersion[] = [];
  for (const record of output.split(RECORD_SEPARATOR)) {
    // A record reads "<time>\0\n:<modes> <old blob> <new blob> <status>\0<path>\0", with a second path after a rename
    const [time, rawLine, firstPath, secondPath] = record.split('\0');
    const [, , , blobId, status] = rawLine?.trim().split(' ') ?? [];
    if (!blobId || !status || DELETED_BLOB.test(blobId)) {
      continue;
    }

    const isMovedOrCopied = status.startsWith('R') || status.startsWith('C');
    logged.push({ blobId, savedAt: Number(time) * 1000, pathInVault: isMovedOrCopied ? secondPath : firstPath });
  }

  return logged;
}

// Collapse each run of identical text into its oldest commit, the one that first saved it
function collapseRepeats(logged: LoggedVersion[]): LoggedVersion[] {
  const collapsed: LoggedVersion[] = [];
  for (const version of logged) {
    if (collapsed.length > 0 && collapsed[collapsed.length - 1].blobId === version.blobId) {
      collapsed[collapsed.length - 1] = version;
    } else {
      collapsed.push(version);
    }
  }

  return collapsed;
}

// Turn a note's log into its past versions, newest first, leaving out the text it holds now
export function readVersionLog(output: string, currentBlobId: string | undefined, currentPath: string): NoteVersion[] {
  const versions: NoteVersion[] = [];
  for (const { blobId, savedAt, pathInVault } of collapseRepeats(parseLog(output))) {
    if (blobId !== currentBlobId) {
      versions.push({ blobId, savedAt, formerPath: pathInVault === currentPath ? undefined : pathInVault });
    }
  }

  return versions;
}
