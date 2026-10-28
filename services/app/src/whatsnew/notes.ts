// What's new: the rules the page and the card share. The notes are files in
// release_notes/ at the repository root, one per change, which the API ships
// and serves with each person's read state (docs/design/whats-new.md).
import type { components } from "../api/schema";

export type ReleaseNote = components["schemas"]["ReleaseNote"];

export interface ReleaseDay {
  /** `YYYY-MM-DD`. */
  date: string;
  notes: ReleaseNote[];
}

/** The notes grouped by day, newest day first. Notes keep the API's order
 * inside a day, which is the order they arrived in. */
export function releaseDays(notes: readonly ReleaseNote[]): ReleaseDay[] {
  const byDate = new Map<string, ReleaseNote[]>();
  for (const note of notes) {
    const day = byDate.get(note.date);
    if (day) day.push(note);
    else byDate.set(note.date, [note]);
  }
  return [...byDate]
    .map(([date, dayNotes]) => ({ date, notes: dayNotes }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** "Mittwoch, 28. Oktober 2026" for `2026-10-28`. */
export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("de-AT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
