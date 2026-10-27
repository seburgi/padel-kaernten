// What the courts screen shows for a search: which venues have a court
// free for the whole game, at which start times and for how much
// (docs/design/slots.md). Pure, so it is tested without a screen.
import type { Court, Slot, Venue } from "../api/client";

export const TZ = "Europe/Vienna";

export type Area = "alle" | "halle" | "freiluft";

export type Search = {
  day: string; // YYYY-MM-DD
  from: number; // minutes after midnight, earliest start
  to: number; // latest end
  duration: 60 | 90 | 120;
  area: Area;
};

export const DURATIONS = [60, 90, 120] as const;

/** A start time on one court, with the price of the whole game in cents
 * when every part of it has one. */
export type Option = { start: number; priceCents: number | null };

export type Hit = {
  venue: Venue;
  courts: { court: Court; options: Option[] }[];
  area: string | null;
  mixed: boolean;
};

export type Result = {
  hits: Hit[];
  bookedOut: Venue[];
  notYet: Venue[];
  failed: Venue[];
};

/** Today's date and minute in Vienna, whatever the device's zone. */
export function viennaNow(now = new Date()): { date: string; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** "Heute", "Morgen" or the weekday, and "27.10.". */
export function dayLabel(day: string, today: string): { top: string; sub: string } {
  const d = new Date(`${day}T12:00:00Z`);
  const diff = Math.round((d.getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 864e5);
  const top = diff === 0 ? "Heute" : diff === 1 ? "Morgen" : (WEEKDAYS[d.getUTCDay()] ?? "");
  return { top, sub: `${d.getUTCDate()}.${d.getUTCMonth() + 1}.` };
}

/** "17:30". */
export function hm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Minutes of "17:30", or null. */
export function parseHm(s: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? "");
  return m ? Math.min(1440, Number(m[1]) * 60 + Number(m[2])) : null;
}

/** The start times on one court's free slots of one day: free for the
 * whole duration, starting at or after from (and not in the past), ending
 * by to. */
export function options(free: Slot[], step: number, s: Search, notBefore: number): Option[] {
  const blocks: { from: number; to: number; parts: Slot[] }[] = [];
  for (const slot of free) {
    const last = blocks[blocks.length - 1];
    if (last && last.to === slot.from) {
      last.to = slot.to;
      last.parts.push(slot);
    } else blocks.push({ from: slot.from, to: slot.to, parts: [slot] });
  }
  const out: Option[] = [];
  const grid = step > 0 ? step : 30;
  for (const block of blocks) {
    for (let t = block.from; t + s.duration <= block.to; t += grid) {
      if (t < s.from || t + s.duration > s.to || t < notBefore) continue;
      let cents = 0;
      let known = true;
      for (const part of block.parts) {
        const overlap = Math.min(part.to, t + s.duration) - Math.max(part.from, t);
        if (overlap <= 0) continue;
        if (!part.pricePerHour) {
          known = false;
          break;
        }
        cents += (part.pricePerHour.amount * overlap) / 60;
      }
      out.push({ start: t, priceCents: known ? Math.round(cents) : null });
    }
  }
  return out;
}

/** Überdacht counts as weatherproof, so with the halls. */
function inArea(court: Court, area: Area): boolean {
  if (area === "alle") return true;
  return (court.area === "ueberdacht" ? "halle" : court.area) === area;
}

/** Every venue sorted into hits, booked out, not bookable yet and failed. */
export function search(venues: Venue[], s: Search, now = viennaNow()): Result {
  const result: Result = { hits: [], bookedOut: [], notYet: [], failed: [] };
  const notBefore = s.day === now.date ? now.minute : -1;
  for (const venue of venues) {
    if (venue.failed) {
      result.failed.push(venue);
      continue;
    }
    if (venue.notBookable.includes(s.day)) {
      result.notYet.push(venue);
      continue;
    }
    if (!venue.courts.some((c) => inArea(c, s.area))) continue;
    const courts = venue.courts
      .filter((c) => inArea(c, s.area))
      .map((court) => ({
        court,
        options: options(
          court.free.filter((f) => f.day === s.day),
          venue.step,
          s,
          notBefore,
        ),
      }))
      .filter((c) => c.options.length > 0);
    const areas = new Set(venue.courts.map((c) => c.area ?? null));
    if (courts.length === 0) result.bookedOut.push(venue);
    else
      result.hits.push({
        venue,
        courts,
        mixed: areas.size > 1,
        area: areas.size === 1 ? ([...areas][0] ?? null) : null,
      });
  }
  return result;
}

/** The search in the address, so a link opens the same search. */
export function toHash(s: Search): string {
  const area = s.area !== "alle" ? `&plaetze=${s.area}` : "";
  return `#tag=${s.day}&ab=${hm(s.from)}&bis=${hm(s.to)}&dauer=${s.duration}${area}`;
}

/** The search a link names, filled in from the defaults: today, or
 * tomorrow when it is late. */
export function fromHash(hash: string, days: string[], now = viennaNow()): Search {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const fallbackDay = now.minute > 21 * 60 && days[1] ? days[1] : (days[0] ?? now.date);
  const day = days.includes(q.get("tag") ?? "") ? (q.get("tag") as string) : fallbackDay;
  const duration = Number(q.get("dauer"));
  const plaetze = q.get("plaetze");
  const s: Search = {
    day,
    from: parseHm(q.get("ab")) ?? 17 * 60,
    to: parseHm(q.get("bis")) ?? 22 * 60,
    duration: (DURATIONS as readonly number[]).includes(duration)
      ? (duration as Search["duration"])
      : 90,
    area: plaetze === "halle" || plaetze === "freiluft" ? plaetze : "alle",
  };
  return fit(s);
}

/** The window holds at least one game. */
export function fit(s: Search): Search {
  return s.to - s.from < s.duration ? { ...s, to: Math.min(1440, s.from + s.duration) } : s;
}

/** "34,50 €". */
export function euro(cents: number): string {
  return `${(cents / 100).toLocaleString("de-AT", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;
}

/** The days from today on. */
export function upcoming(days: string[], today: string): string[] {
  return days.filter((d) => d >= today);
}

/** How old the snapshot is, in minutes. */
export function ageMinutes(takenAt: string, now = Date.now()): number {
  return Math.max(0, Math.round((now - new Date(takenAt).getTime()) / 60000));
}

/** "Stand: Di., 18:05". */
export function standLabel(takenAt: string): string {
  const t = new Date(takenAt).toLocaleString("de-AT", {
    timeZone: TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Stand: ${t}`;
}

/** Google Maps for the venue: name and address, so it finds the place. */
export function mapLink(v: Venue): string | null {
  if (!v.address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${v.name}, ${v.address}`)}`;
}

/** The booking page for the day, or any. */
export function bookingLink(v: Venue, day: string): string {
  return v.links[day] ?? Object.values(v.links)[0] ?? "#";
}

export const AREA_LABEL: Record<string, string> = {
  halle: "Halle",
  freiluft: "Freiluft",
  ueberdacht: "Überdacht",
};
