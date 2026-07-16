import { MentionEntry } from './fileMentions';

interface CachedListing {
  entries: MentionEntry[];
  fetchedAt: number;
}

const MAX_CACHED_DIRECTORIES = 100;
const REFRESH_AFTER_MS = 2000;

// directory listings for the @ popup, served from memory and refreshed quietly as they age
export class DirectoryCache {
  private readonly listings = new Map<string, CachedListing>();
  private readonly inFlight = new Map<string, Promise<MentionEntry[] | undefined>>();

  constructor(private readonly fetchListing: (dirPath: string) => Promise<MentionEntry[] | undefined>) {}

  // the listing already in memory, possibly a couple of seconds stale
  cached(dirPath: string): MentionEntry[] | undefined {
    const hit = this.listings.get(dirPath);
    if (!hit) {
      return undefined;
    }

    // re-insert so trimming drops the least recently used listing
    this.listings.delete(dirPath);
    this.listings.set(dirPath, hit);

    if (Date.now() - hit.fetchedAt > REFRESH_AFTER_MS) {
      void this.refresh(dirPath);
    }
    return hit.entries;
  }

  list(dirPath: string): Promise<MentionEntry[]> {
    const hit = this.cached(dirPath);
    if (hit) {
      return Promise.resolve(hit);
    }

    return this.refresh(dirPath).then((entries) => entries ?? []);
  }

  prefetch(dirPath: string): void {
    if (!this.listings.has(dirPath)) {
      void this.refresh(dirPath);
    }
  }

  // one fetch per directory at a time, a timed-out fetch keeps the old listing
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
