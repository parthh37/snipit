/** Searching, tag lists and date groups for the gallery. Pure, so it is easy to check. */
import type { Snip } from "../lib/api";

/** Whether `snip` matches every word of `query` (in its name, tags, app or window title) and has `tag`. */
export function matches(snip: Snip, query: string, tag: string | null) {
  if (tag && !snip.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
    return false;
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [snip.name, snip.app ?? "", snip.title ?? "", ...snip.tags]
    .join("\n")
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

/** Every tag in use with how many snips have it, most used first. */
export function tagCounts(snips: Snip[]): [string, number][] {
  const counts = new Map<string, { tag: string; n: number }>();
  for (const snip of snips) {
    for (const tag of snip.tags) {
      const key = tag.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.n++;
      else counts.set(key, { tag, n: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag))
    .map(({ tag, n }) => [tag, n]);
}

export interface DateGroup {
  label: string;
  /** Every snip in it was taken on the same day, so cards only need the time. */
  sameDay: boolean;
  snips: Snip[];
}

const DAY = 24 * 60 * 60 * 1000;
const monthFormat = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long" });

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Today, Yesterday, the other days of the past week by name, then months. */
export function dateLabel(ms: number, now: number) {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY);
  if (days <= 0) return { label: "Today", sameDay: true };
  if (days === 1) return { label: "Yesterday", sameDay: true };
  if (days < 7) return { label: weekdayFormat.format(ms), sameDay: true };
  return { label: monthFormat.format(ms), sameDay: false };
}

/** Splits newest-first snips into date groups, keeping their order. */
export function groupByDate(snips: Snip[], now: number): DateGroup[] {
  const groups: DateGroup[] = [];
  for (const snip of snips) {
    const { label, sameDay } = dateLabel(snip.modified, now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.snips.push(snip);
    else groups.push({ label, sameDay, snips: [snip] });
  }
  return groups;
}
