// Waits a set time, and writes a moment as a date or as how long ago it was

const TIME_AGO_FORMAT = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;
const DAY_SECONDS = 24 * HOUR_SECONDS;

// Each unit with its length in seconds, largest first
const TIME_UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['year', 365 * DAY_SECONDS],
  ['month', 30 * DAY_SECONDS],
  ['week', 7 * DAY_SECONDS],
  ['day', DAY_SECONDS],
  ['hour', HOUR_SECONDS],
  ['minute', MINUTE_SECONDS]
];

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Say how long ago a timestamp was in its largest whole unit, like "3 hours ago" or "yesterday"
export function describeTimeAgo(timestamp: number): string {
  const secondsAgo = (Date.now() - timestamp) / 1000;
  for (const [unit, unitSeconds] of TIME_UNITS) {
    if (secondsAgo >= unitSeconds) {
      return TIME_AGO_FORMAT.format(-Math.floor(secondsAgo / unitSeconds), unit);
    }
  }
  return 'just now';
}

// Write a timestamp the way the user's locale writes a date and time
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
