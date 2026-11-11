// What the game screens share (docs/design/games.md): times, money, names,
// and what each problem means in German.
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, call, type Game, type Span } from "../api/client";

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

/** The places whoever proposed a game may give it (Seb, 2026-11-11), as
 * the API takes them (games.MinPlayers, games.MaxPlayers). */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

const WORDS = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht"];

/** "vier" for 4; past eight, the digits. */
export function countWord(n: number): string {
  return WORDS[n] ?? String(n);
}

/** A name to show: the one given, or the address before the @. */
export function shown(p: { email: string; name: string }): string {
  return p.name || p.email.split("@")[0]!;
}

/** The coming games: a group's, or of every group one is in. */
export function useGames(group?: number) {
  return useQuery({
    queryKey: ["games", group ?? "all"],
    queryFn: async () =>
      (await call(api.GET("/api/v1/games", { params: { query: group ? { groupId: group } : {} } })))
        .items,
    retry: false,
  });
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => call(api.GET("/api/v1/me")),
    retry: false,
  });
}

/** How one stands in a game: in, reserve, out, or not answered yet. */
export const answerOf = (g: Game, email: string) =>
  g.lineup.find((p) => p.email === email)?.state ?? "none";

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
      case "places":
        return "So viele Plätze gehen nicht: nie weniger, als schon dabei sind, und höchstens acht.";
      case "not-reserve":
        return "Diese Person wartet nicht mehr auf einen Platz.";
    }
  }
  return "Das hat nicht geklappt. Versuch es nochmal.";
}

type Days = { email: string; days: { day: string; spans: Span[]; declined: boolean }[] };
type Person = { email: string; name: string };

/** Whether the spans cover from start to end without a gap. */
function covers(spans: Span[], start: number, end: number): boolean {
  let at = start;
  for (const s of [...spans].sort((a, b) => a.from - b.from))
    if (s.from <= at && s.to > at) at = s.to;
  return at >= end;
}

/** Those who have not answered a game, by what they entered in "Wann kann
 * ich?" for its day (feedback #69): free for the whole game, not (a declined
 * day or spans that leave part of it out), or nothing entered. Without the
 * group's days everyone is unknown. */
export function byTime(
  g: Pick<Game, "day" | "start" | "minutes">,
  people: Person[],
  members: Days[] | undefined,
): { free: Person[]; busy: Person[]; unknown: Person[] } {
  const out = { free: [] as Person[], busy: [] as Person[], unknown: [] as Person[] };
  for (const p of people) {
    const d = members?.find((m) => m.email === p.email)?.days.find((x) => x.day === g.day);
    if (!d) out.unknown.push(p);
    else if (!d.declined && covers(d.spans, g.start, g.start + g.minutes)) out.free.push(p);
    else out.busy.push(p);
  }
  return out;
}

/** "Anna", "Anna und Lisa", "Anna, Eva und Lisa". */
export function names(people: Person[]): string {
  const n = people.map(shown);
  return n.length < 2 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} und ${n[n.length - 1]}`;
}
