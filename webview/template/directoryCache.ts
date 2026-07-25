// Caches the directory listings the @ mention popup browses
import { MentionEntry } from './fileMentions';

interface CachedListing {
  entries: MentionEntry[];
  fetchedAt: number;
}

const MAX_CACHED_DIRECTORIES = 100;
const REFRESH_AFTER_MS = 2000;

// Listings served from memory and refreshed in the background as they age
export class DirectoryCache {
  private readonly listings = new Map<string, CachedListing>();
  private readonly inFlight = new Map<string, Promise<MentionEntry[] | undefined>>();

  constructor(private readonly fetchListing: (dirPath: string) => Promise<MentionEntry[] | undefined>) {}

  // Return the listing held in memory, and start a refresh once it is a couple of seconds old
  cached(dirPath: string): MentionEntry[] | undefined {
    const hit = this.listings.get(dirPath);
    if (!hit) {
      return undefined;
    }

    // Re-insert so trimming drops the least recently used listing
    this.listings.delete(dirPath);
    this.listings.set(dirPath, hit);

    if (Date.now() - hit.fetchedAt > REFRESH_AFTER_MS) {
      void this.refresh(dirPath);
    }
    return hit.entries;
  }

  // Serve the listing from memory, or wait for a fresh one
  list(dirPath: string): Promise<MentionEntry[]> {
    const hit = this.cached(dirPath);
    if (hit) {
      return Promise.resolve(hit);
    }

    return this.refresh(dirPath).then((entries) => entries ?? []);
  }

  // Fetch a listing ahead of time, leaving a directory already in memory alone
  prefetch(dirPath: string): void {
    if (!this.listings.has(dirPath)) {
      void this.refresh(dirPath);
    }
  }

  // Share one fetch per directory, keeping the old listing when a fetch times out
  private refresh(dirPath: string): Promise<MentionEntry[] | undefined> {
    const pending = this.inFlight.get(dirPath);
    if (pending) {
      return pending;
    }

    const request = this.fetchListing(dirPath).then((entries) => {
      this.inFlight.delete(dirPath);
      if (entries) {
        this.store(dirPath, entries);
      }
      return entries;
    });
    this.inFlight.set(dirPath, request);
    return request;
  }

  // Store a listing as the newest one, dropping the oldest once the cap is passed
  private store(dirPath: string, entries: MentionEntry[]): void {
    this.listings.delete(dirPath);
    this.listings.set(dirPath, { entries, fetchedAt: Date.now() });

    if (this.listings.size > MAX_CACHED_DIRECTORIES) {
      const oldest = this.listings.keys().next().value;
      if (oldest !== undefined) {
        this.listings.delete(oldest);
      }
    }
  }
}
