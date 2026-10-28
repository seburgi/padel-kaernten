// Times on the grid the API keeps (docs/design/availability.md): minutes
// after midnight in Vienna, every half hour from 6:00 to 24:00.
import type { Span } from "../api/client";

export const FIRST = 6 * 60;
export const LAST = 24 * 60;
export const STEP = 30;

/** Every point on the grid, 6:00 to 24:00. */
export const GRID: number[] = Array.from(
  { length: (LAST - FIRST) / STEP + 1 },
  (_, i) => FIRST + i * STEP,
);

/** The quick choices in the day editor. */
export const QUICK: { label: string; span: Span }[] = [
  { label: "Früh 7–9", span: { from: 7 * 60, to: 9 * 60 } },
  { label: "Mittag 12–14", span: { from: 12 * 60, to: 14 * 60 } },
  { label: "Abend ab 18", span: { from: 18 * 60, to: LAST } },
  { label: "Ganzer Tag", span: { from: FIRST, to: LAST } },
];

/** 420 is "7:00", 1110 "18:30". */
export function clock(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

/** "7:00–9:00, 18:30–22:00", or "" for none. */
export function spansText(spans: Span[]): string {
  return spans.map((s) => `${clock(s.from)}–${clock(s.to)}`).join(", ");
}

/** Sorted, with spans that overlap or touch joined, as the API keeps them.
 * Empty or backwards spans are left out. */
export function merge(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of [...spans].filter((s) => s.to > s.from).sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

/** Each day from from to to, both included, as YYYY-MM-DD. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    if (day > to) return out;
    out.push(day);
  }
}

/** 1 Monday to 7 Sunday. */
export function weekday(day: string): number {
  return ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const WEEKDAYS_LONG = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];

/** "Do 29.10." */
export function dayLabel(day: string): string {
  const [, m, d] = day.split("-");
  return `${WEEKDAYS[weekday(day) - 1]} ${Number(d)}.${Number(m)}.`;
}
