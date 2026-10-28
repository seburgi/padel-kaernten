// What the game screens share (docs/design/games.md): times, money, names,
// and what each problem means in German.
import { ApiError, type Game } from "../api/client";

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** "Do 29.10." */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

/** 1110 is "18:30". */
export function clock(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

/** "18:30–20:00" */
export function span(start: number, minutes: number): string {
  return `${clock(start)}–${clock(start + minutes)}`;
}

/** "15 €" or "12,50 €". */
export function euros(cents: number): string {
  return new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** A name to show: the one given, or the address before the @. */
export function shown(p: { email: string; name: string }): string {
  return p.name || p.email.split("@")[0]!;
}

export const playing = (g: Game) => g.lineup.filter((p) => p.state === "in");
export const reserves = (g: Game) => g.lineup.filter((p) => p.state === "reserve");

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.kind) {
      case "court-gone":
        return "Der Platz ist inzwischen weg. Die Liste ist neu geladen.";
      case "game-closed":
        return "Das Spiel ist abgesagt oder schon vorbei.";
      case "not-allowed":
        return "Das kann nur, wer das Spiel vorgeschlagen hat.";
      case "no-snapshot":
        return "Die Plätze wurden noch nicht abgefragt.";
    }
  }
  return "Das hat nicht geklappt. Versuch es nochmal.";
}
