// Wer kann wann, a group's own page (/groups/:id/who-can; Seb, 2026-11-04,
// feedback #73; first on the group's page, 2026-10-31, feedback #68): the
// next 14 days, every half hour from 7 to 22 (times entered outside are
// left out), the darker the more members can. Where four or more can, the
// cell says whether a game fits: a dot when a court of the group's area is
// free, red when none suits, and the day's sheet says why (GET
// /groups/{id}/fours). It scales with the group, where a row per member
// would not. Wide, the days are rows and a hover names who can; on a phone
// the grid turns, days side by side and the time running down, and a tap on
// a day opens it in the sheet as blocks of time with their names. Members
// only (GET /groups/{id}/availability).
import { useQuery } from "@tanstack/react-query";
import { useState, type MouseEvent } from "react";
import { Link } from "react-router";
import { api, call, type AvailabilityDay, type FourHalfHour } from "../api/client";
import { Sheet } from "@burgstaller/web/sheet";
import { card, link, quiet } from "../ui";
import { GroupFrame } from "./Group";

const FIRST = 7 * 60;
const STEP = 30;
const LAST = 22 * 60;
const SLOTS = (LAST - FIRST) / STEP;
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const FOUR = 4;

type Member = { email: string; name: string; days: AvailabilityDay[] };

/** "Mi 4.11." */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

const weekend = (day: string) => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());

/** 1110 is "18:30". */
export function clock(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

const shown = (m: { email: string; name: string }) => m.name || m.email.split("@")[0]!;

/** "A", "A und B", "A, B und C". */
function and(names: string[]): string {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

/** Each day from from to to, both included, as YYYY-MM-DD. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    if (day > to) return out;
    out.push(day);
  }
}

export type Day = {
  day: string;
  /** Who can, per half hour from 7:00. */
  can: string[][];
  /** Where four can: whether a game fits, and why not; per half hour. */
  four: (FourHalfHour | undefined)[];
  declined: string[];
  open: string[];
};

/** The window as days, each with who can in every half hour, and what the
 * fours say about it. */
export function overlay(
  from: string,
  to: string,
  members: Member[],
  fours: FourHalfHour[] = [],
): Day[] {
  return daysBetween(from, to).map((day) => {
    const out: Day = {
      day,
      can: Array.from({ length: SLOTS }, () => []),
      four: Array.from({ length: SLOTS }, () => undefined),
      declined: [],
      open: [],
    };
    for (const m of members) {
      const d = m.days.find((x) => x.day === day);
      if (!d) out.open.push(shown(m));
      else if (d.declined) out.declined.push(shown(m));
      for (const s of d?.spans ?? [])
        for (let t = s.from; t < s.to; t += STEP) out.can[(t - FIRST) / STEP]?.push(shown(m));
    }
    for (const h of fours) {
      const i = (h.start - FIRST) / STEP;
      if (h.day === day && i >= 0 && i < SLOTS) out.four[i] = h;
    }
    return out;
  });
}

/** What a half hour with four says: "fits", why not, or "" when unknown. */
const verdict = (h?: FourHalfHour) =>
  !h ? "" : h.fits ? "fits" : `${h.why ?? ""}:${h.venues.join(",")}`;

export type Block = { from: number; to: number; who: string[]; four?: FourHalfHour };

/** One day as blocks of time where the same people can, with the same
 * verdict on a game. */
export function blocks(d: Day): Block[] {
  const out: Block[] = [];
  d.can.forEach((who, i) => {
    const from = FIRST + i * STEP;
    const four = d.four[i];
    const last = out[out.length - 1];
    if (
      last &&
      last.to === from &&
      last.who.join() === who.join() &&
      verdict(last.four) === verdict(four)
    )
      last.to = from + STEP;
    else out.push({ from, to: from + STEP, who, four });
  });
  return out.filter((b) => b.who.length > 0);
}

/** The short word on why no game fits. */
export function whyShort(h: FourHalfHour, area: string): string {
  switch (h.why) {
    case "short":
      return "Zu viert zu kurz";
    case "venues":
      return "Zu wenige fahren hin";
    case "area":
      return area === "freiluft" ? "Nur in der Halle frei" : "Nur draußen frei";
    default:
      return "Kein Platz frei";
  }
}

/** Why no game fits, in a sentence or two. */
export function whyLong(h: FourHalfHour, area: string): string {
  const v = and(h.venues);
  switch (h.why) {
    case "short":
      return "Vier können hier nicht eine ganze Stunde lang am Stück, und kürzer geht kein Spiel.";
    case "venues":
      return `Frei wäre ein Platz in ${v}, aber dorthin fahren keine vier von denen, die können. Wohin jemand fährt, steht unter Deine Plätze.`;
    case "area":
      return area === "freiluft"
        ? `Draußen ist kein Platz frei, in der Halle schon: ${v}. Ihr spielt nur draußen.`
        : `In der Halle ist kein Platz frei, draußen schon: ${v}. Ihr spielt nur in der Halle.`;
    default:
      return h.venues.length === 0
        ? "Keine Anlage hat dann einen frei."
        : `Keine Anlage hat dann einen frei, und ${v} ${h.venues.length === 1 ? "nimmt" : "nehmen"} für diesen Tag noch keine Buchungen an.`;
  }
}

/** The cell's colour: the accent, stronger the more can; red where four
 * can but no game fits. */
function shade(n: number, miss = false): string | undefined {
  if (n === 0) return undefined;
  if (miss) return "color-mix(in srgb, var(--color-danger) 70%, var(--color-sunken))";
  const pct = n < FOUR ? [0, 22, 38, 54][n]! : Math.min(100, 72 + (n - FOUR) * 7);
  return `color-mix(in srgb, var(--color-accent) ${pct}%, var(--color-sunken))`;
}

/** A dot where four can and a game fits; without the fours (still loading,
 * or none), any four get one, as before. */
function Cell({
  n,
  four,
  known,
  onEnter,
}: {
  n: number;
  four?: FourHalfHour;
  known: boolean;
  onEnter?: (e: MouseEvent<HTMLElement>) => void;
}) {
  const miss = n >= FOUR && four !== undefined && !four.fits;
  const dot = n >= FOUR && (known ? four?.fits === true : true);
  return (
    <span
      className="relative block rounded-[2px] bg-sunken"
      style={{ background: shade(n, miss) }}
      data-miss={miss || undefined}
      onMouseEnter={onEnter}
    >
      {dot && (
        <span className="absolute top-1/2 left-1/2 size-1 -translate-1/2 rounded-full bg-card" />
      )}
    </span>
  );
}

type Hover = { d: Day; i: number; x: number; y: number };

/** The page: the grid with the group's name above it. */
export function WhoCanPage() {
  return (
    <GroupFrame>
      {(g) =>
        g.how !== "member" ? (
          <main>
            <h1 className="mt-2 mb-2 text-2xl font-semibold">Wer kann wann</h1>
            <p className="mb-4 text-ink-muted">Wer wann kann, sieht nur, wer in der Gruppe ist.</p>
            <Link to={`/groups/${g.id}`} className={quiet}>
              Zur Gruppe
            </Link>
          </main>
        ) : (
          <main>
            <Link to={`/groups/${g.id}`} className={`${link} text-sm`}>
              ← {g.name}
            </Link>
            <h1 className="mt-1 mb-1 text-2xl font-semibold">Wer kann wann</h1>
            <p className="mb-4 text-ink-muted">
              Die nächsten 14 Tage der ganzen Gruppe. Ein Punkt heißt: vier können, und ein Platz
              ist frei. Rot heißt: vier können, aber kein passender Platz.{" "}
              <span className="md:hidden">Tipp einen Tag an, dann steht da, warum.</span>
              <span className="max-md:hidden">Klick einen Tag an, dann steht da, warum.</span>
            </p>
            <WhoCan group={g.id} area={g.area} />
          </main>
        )
      }
    </GroupFrame>
  );
}

/** On the group's page: the way to Wer kann wann. */
export function WhoCanLink({ group }: { group: number }) {
  return (
    <Link
      to={`/groups/${group}/who-can`}
      className={`${card} mb-6 flex items-center justify-between gap-3 p-4 hover:bg-hover`}
    >
      <span className="min-w-0">
        <span className="block font-semibold">Wer kann wann</span>
        <span className="block text-sm text-ink-muted">
          Die nächsten 14 Tage auf einen Blick, und warum es wann nicht passt
        </span>
      </span>
      <span aria-hidden="true" className="text-xl text-ink-muted">
        ›
      </span>
    </Link>
  );
}

export function WhoCan({ group, area = "alle" }: { group: number; area?: string }) {
  const q = useQuery({
    queryKey: ["group-availability", group],
    queryFn: () =>
      call(
        api.GET("/api/v1/groups/{groupId}/availability", {
          params: { path: { groupId: group } },
        }),
      ),
    retry: false,
  });
  // Where four can, whether a court suits; the grid shows without it.
  const fours = useQuery({
    queryKey: ["fours", group],
    queryFn: () =>
      call(api.GET("/api/v1/groups/{groupId}/fours", { params: { path: { groupId: group } } })),
    retry: false,
  });
  const [hover, setHover] = useState<Hover | null>(null);
  const [open, setOpen] = useState<Day | null>(null);

  const known = fours.isSuccess;
  const days = q.data ? overlay(q.data.from, q.data.to, q.data.members, fours.data?.halfHours) : [];
  const total = q.data?.members.length ?? 0;
  const nobody = days.every((d) => d.can.every((w) => w.length === 0));
  const best = (d: Day) => Math.max(...d.can.map((w) => w.length));
  const misses = (d: Day) =>
    d.can.some((w, i) => w.length >= FOUR && d.four[i] && !d.four[i]!.fits);
  const dayName = (d: Day) =>
    `${dayLabel(d.day)}: bis zu ${best(d)} von ${total}${misses(d) ? ", teils ohne passenden Platz" : ""}`;
  const enter = (d: Day, i: number) => (e: MouseEvent<HTMLElement>) => {
    const box = e.currentTarget.closest("[data-grid]")!.getBoundingClientRect();
    const cell = e.currentTarget.getBoundingClientRect();
    setHover({ d, i, x: cell.left - box.left + cell.width / 2, y: cell.top - box.top });
  };
  const hoverFour = hover && hover.d.can[hover.i]!.length >= FOUR ? hover.d.four[hover.i] : null;

  return (
    <section className="mb-6" aria-label="Wer kann wann">
      {q.isPending && (
        <div
          aria-busy="true"
          aria-label="Lädt"
          className="h-40 animate-skeleton rounded-2xl border border-line bg-sunken"
        />
      )}
      {q.isError && (
        <p className="text-sm text-ink-muted" role="alert">
          Wer wann kann, konnte nicht geladen werden.
        </p>
      )}
      {q.data && nobody && (
        <p className="text-sm text-ink-muted">
          Noch hat niemand Zeiten eingetragen.{" "}
          <Link to="/availability" className={link}>
            Wann kann ich?
          </Link>
        </p>
      )}
      {q.data && !nobody && (
        <>
          {/* Wide: a day per row, hover for who. */}
          <div
            className={`${card} relative p-3 max-md:hidden`}
            data-grid
            onMouseLeave={() => setHover(null)}
          >
            <div className="mb-1 grid grid-cols-[4.5rem_1fr] gap-3 font-mono text-[10px] text-ink-faint">
              <span />
              <span className="flex justify-between">
                {[7, 10, 13, 16, 19, 22].map((h) => (
                  <span key={h}>{h}</span>
                ))}
              </span>
            </div>
            <div className="space-y-[3px]">
              {days.map((d) => (
                <button
                  key={d.day}
                  type="button"
                  className="grid w-full grid-cols-[4.5rem_1fr] items-center gap-3 rounded-sm text-left hover:bg-hover"
                  aria-label={dayName(d)}
                  onClick={() => setOpen(d)}
                >
                  <span
                    className={`font-mono text-xs ${weekend(d.day) ? "text-ink-muted" : "text-ink-secondary"}`}
                  >
                    {dayLabel(d.day)}
                  </span>
                  <span className="grid h-[18px] grid-cols-[repeat(30,minmax(0,1fr))] gap-px">
                    {d.can.map((w, i) => (
                      <Cell
                        key={i}
                        n={w.length}
                        four={d.four[i]}
                        known={known}
                        onEnter={enter(d, i)}
                      />
                    ))}
                  </span>
                </button>
              ))}
            </div>
            {hover && (
              <div
                role="tooltip"
                className="pointer-events-none absolute z-10 w-max max-w-64 -translate-x-1/2 -translate-y-full rounded-lg bg-ink px-3 py-2 text-[13px] text-ink-inverse shadow-lg"
                style={{ left: hover.x, top: hover.y - 6 }}
              >
                <div className="font-semibold">
                  {dayLabel(hover.d.day)} · {clock(FIRST + hover.i * STEP)}–
                  {clock(FIRST + (hover.i + 1) * STEP)}
                </div>
                <div>
                  {hover.d.can[hover.i]!.length} von {total}
                  {hover.d.can[hover.i]!.length > 0 && `: ${hover.d.can[hover.i]!.join(", ")}`}
                </div>
                {hoverFour && (
                  <div className="font-semibold">
                    {hoverFour.fits ? "Platz frei" : whyShort(hoverFour, area)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Phone: the days side by side, the time running down. */}
          <div className={`${card} p-2.5 md:hidden`}>
            <div className="mb-1 grid grid-cols-[1.25rem_repeat(14,minmax(0,1fr))] gap-0.5 text-center font-mono text-[10px] leading-tight text-ink-muted">
              <span />
              {days.map((d) => (
                <span key={d.day}>
                  {dayLabel(d.day).slice(0, 2)}
                  <b className="block font-medium text-ink-secondary">
                    {Number(d.day.slice(8, 10))}
                  </b>
                </span>
              ))}
            </div>
            <div className="grid grid-cols-[1.25rem_repeat(14,minmax(0,1fr))] gap-0.5">
              <span className="relative font-mono text-[9.5px] text-ink-faint">
                {[7, 10, 13, 16, 19].map((h) => (
                  <span
                    key={h}
                    className="absolute right-0.5"
                    style={{ top: `${((h * 60 - FIRST) / (LAST - FIRST)) * 100}%` }}
                  >
                    {h}
                  </span>
                ))}
              </span>
              {days.map((d) => (
                <button
                  key={d.day}
                  type="button"
                  className="grid grid-rows-[repeat(30,12px)] gap-px rounded-sm"
                  aria-label={dayName(d)}
                  onClick={() => setOpen(d)}
                >
                  {d.can.map((w, i) => (
                    <Cell key={i} n={w.length} four={d.four[i]} known={known} />
                  ))}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1.5 text-xs text-ink-muted">
            Können:
            {[1, 2, 3].map((n) => (
              <span key={n} className="inline-flex items-center gap-1 pl-1.5">
                <span
                  className="inline-block h-2.5 w-3.5 rounded-[2px]"
                  style={{ background: shade(n) }}
                />
                {n}
              </span>
            ))}
            <span className="inline-flex items-center gap-1 pl-1.5">
              <span
                className="relative inline-block h-2.5 w-3.5 rounded-[2px]"
                style={{ background: shade(FOUR) }}
              >
                <span className="absolute top-1/2 left-1/2 size-1 -translate-1/2 rounded-full bg-card" />
              </span>
              4+, Platz frei
            </span>
            {known && (
              <span className="inline-flex items-center gap-1 pl-1.5">
                <span
                  className="inline-block h-2.5 w-3.5 rounded-[2px]"
                  style={{ background: shade(FOUR, true) }}
                />
                4+, kein passender Platz
              </span>
            )}
          </div>
        </>
      )}
      {open && (
        <Sheet label={dayLabel(open.day)} wide="float" onClose={() => setOpen(null)}>
          <DayBlocks d={open} total={total} group={group} area={area} />
          <button type="button" className={`${quiet} mt-3 w-full`} onClick={() => setOpen(null)}>
            Schließen
          </button>
        </Sheet>
      )}
    </section>
  );
}

function DayBlocks({
  d,
  total,
  group,
  area,
}: {
  d: Day;
  total: number;
  group: number;
  area: string;
}) {
  const list = blocks(d);
  const most = Math.max(0, ...list.map((b) => b.who.length));
  const fits = list.some((b) => b.who.length >= FOUR && b.four?.fits);
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold">{dayLabel(d.day)}</h3>
        <span className="text-sm text-ink-muted">
          bis zu {most} von {total}
        </span>
      </div>
      {list.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">An diesem Tag hat noch niemand Zeit.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {list.map((b) => {
            const four = b.who.length >= FOUR ? b.four : undefined;
            const miss = four !== undefined && !four.fits;
            return (
              <li
                key={b.from}
                className={`rounded-lg px-2.5 py-1.5 text-sm ${
                  miss
                    ? "bg-danger-subtle ring-1 ring-danger-border ring-inset"
                    : b.who.length >= FOUR
                      ? "bg-accent-subtle ring-1 ring-accent-border ring-inset"
                      : "bg-sunken"
                }`}
              >
                <div className="grid grid-cols-[6.5rem_1.75rem_1fr] items-center gap-2">
                  <span className="font-mono text-xs text-ink-secondary">
                    {clock(b.from)}–{clock(b.to)}
                  </span>
                  <span
                    className={`rounded-md text-center font-mono text-xs font-semibold ${b.who.length >= 3 ? "text-accent-ink" : "text-ink"}`}
                    style={{ background: shade(b.who.length, miss) }}
                  >
                    {b.who.length}
                  </span>
                  <span className="text-ink-secondary">{b.who.join(", ")}</span>
                </div>
                {four?.fits && <p className="mt-1 font-semibold text-accent-text">Platz frei</p>}
                {miss && (
                  <p className="mt-1 text-ink-secondary">
                    <b className="font-semibold text-danger-text">{whyShort(four, area)}.</b>{" "}
                    {whyLong(four, area)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {fits && (
        <p className="mt-2 text-sm text-ink-muted">
          Wo ein Platz frei ist, schlägst du die Zeit unter{" "}
          <Link to={`/groups/${group}/fits`} className={link}>
            Wann passt es für vier?
          </Link>{" "}
          vor.
        </p>
      )}
      <div className="mt-3 space-y-1 text-sm text-ink-muted">
        {d.declined.length > 0 && (
          <p>
            <b className="font-semibold text-ink-secondary">Passt nicht:</b> {d.declined.join(", ")}
          </p>
        )}
        {d.open.length > 0 && (
          <p>
            <b className="font-semibold text-warning-text">Noch offen:</b> {d.open.join(", ")}
          </p>
        )}
      </div>
    </>
  );
}
