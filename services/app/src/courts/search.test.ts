import { describe, expect, it } from "vitest";
import type { Venue } from "../api/client";
import {
  ageMinutes,
  bookingLink,
  dayLabel,
  euro,
  fit,
  fromHash,
  hm,
  mapLink,
  options,
  parseHm,
  search,
  standLabel,
  toHash,
  upcoming,
  viennaNow,
  type Search,
} from "./search";

const base: Search = { day: "2026-10-27", from: 17 * 60, to: 22 * 60, duration: 90, area: "alle" };
const eur = (amount: number) => ({ amount, currency: "EUR" });

function venue(over: Partial<Venue> = {}): Venue {
  return {
    id: "v",
    name: "Venue",
    place: "Ort",
    platform: "etennis",
    failed: false,
    notBookable: [],
    step: 30,
    links: { "2026-10-27": "https://book/27" },
    courts: [
      {
        name: "Court 1",
        area: "halle",
        free: [
          { day: "2026-10-27", from: 1020, to: 1080, pricePerHour: eur(3000) },
          { day: "2026-10-27", from: 1080, to: 1140, pricePerHour: eur(4000) },
          { day: "2026-10-28", from: 1020, to: 1200 },
        ],
      },
    ],
    ...over,
  };
}

describe("options", () => {
  it("finds starts free for the whole game and prices them by the minute", () => {
    const court = venue().courts[0]!;
    const got = options(
      court.free.filter((f) => f.day === "2026-10-27"),
      30,
      base,
      -1,
    );
    // 17:00-18:30: 60 min at 30 € and 30 min at 40 € = 50 €; 17:30-19:00: 30+40 = 15+40 = 55 €
    expect(got).toEqual([
      { start: 1020, priceCents: 5000 },
      { start: 1050, priceCents: 5500 },
    ]);
  });

  it("leaves out the past, the window's edges and unknown prices", () => {
    const court = venue().courts[0]!;
    const today = court.free.filter((f) => f.day === "2026-10-27");
    expect(options(today, 30, base, 1030)).toEqual([{ start: 1050, priceCents: 5500 }]);
    expect(options(today, 30, { ...base, to: 1110 }, -1)).toEqual([
      { start: 1020, priceCents: 5000 },
    ]);
    const tomorrow = court.free.filter((f) => f.day === "2026-10-28");
    expect(options(tomorrow, 60, { ...base, day: "2026-10-28" }, -1)).toEqual([
      { start: 1020, priceCents: null },
      { start: 1080, priceCents: null },
    ]);
    expect(options(tomorrow, 0, { ...base, day: "2026-10-28", duration: 120 }, -1)).toHaveLength(3);
  });
});

describe("search", () => {
  const now = { date: "2026-10-27", minute: 600 };
  it("sorts venues into hits, booked out, not yet and failed", () => {
    const venues = [
      venue({ id: "hit" }),
      venue({ id: "full", courts: [{ name: "C", area: "halle", free: [] }] }),
      venue({ id: "early", notBookable: ["2026-10-27"] }),
      venue({ id: "down", failed: true, courts: [] }),
      venue({ id: "out", courts: [{ name: "C", area: "freiluft", free: [] }] }),
    ];
    const r = search(venues, { ...base, area: "halle" }, now);
    expect(r.hits.map((h) => h.venue.id)).toEqual(["hit"]);
    expect(r.hits[0]!.area).toBe("halle");
    expect(r.bookedOut.map((v) => v.id)).toEqual(["full"]);
    expect(r.notYet.map((v) => v.id)).toEqual(["early"]);
    expect(r.failed.map((v) => v.id)).toEqual(["down"]);
  });

  it("counts überdacht as a hall and tells mixed venues", () => {
    const v = venue({
      courts: [
        { name: "A", area: "ueberdacht", free: [{ day: "2026-10-27", from: 1020, to: 1200 }] },
        { name: "B", area: "freiluft", free: [{ day: "2026-10-27", from: 1020, to: 1200 }] },
      ],
    });
    const halls = search([v], { ...base, area: "halle" }, now);
    expect(halls.hits[0]!.courts.map((c) => c.court.name)).toEqual(["A"]);
    expect(halls.hits[0]!.mixed).toBe(true);
    expect(halls.hits[0]!.area).toBeNull();
    expect(search([v], base, { date: "2026-10-27", minute: 1200 }).bookedOut).toHaveLength(1);
  });
});

describe("the search in the address", () => {
  const days = ["2026-10-27", "2026-10-28"];
  it("goes there and back", () => {
    const s: Search = { day: "2026-10-28", from: 600, to: 720, duration: 60, area: "freiluft" };
    expect(toHash(s)).toBe("#tag=2026-10-28&ab=10:00&bis=12:00&dauer=60&plaetze=freiluft");
    expect(fromHash(toHash(s), days)).toEqual(s);
    expect(toHash(base)).not.toContain("plaetze");
  });
  it("falls back to sensible defaults", () => {
    expect(
      fromHash("#tag=1999-01-01&dauer=45&plaetze=x", days, { date: "2026-10-27", minute: 600 }),
    ).toEqual(base);
    expect(fromHash("", days, { date: "2026-10-27", minute: 22 * 60 }).day).toBe("2026-10-28");
    expect(fromHash("", [], { date: "2026-10-27", minute: 0 }).day).toBe("2026-10-27");
  });
  it("keeps room for one game", () => {
    expect(fit({ ...base, from: 1380, to: 1400 })).toMatchObject({ to: 1440 });
  });
});

describe("helpers", () => {
  it("formats", () => {
    expect(hm(1050)).toBe("17:30");
    expect(parseHm("7:05")).toBe(425);
    expect(parseHm("25:99")).toBe(1440);
    expect(parseHm(null)).toBeNull();
    expect(euro(4800)).toBe("48 €");
    expect(euro(3450)).toBe("34,50 €");
    expect(dayLabel("2026-10-27", "2026-10-27")).toEqual({ top: "Heute", sub: "27.10." });
    expect(dayLabel("2026-10-28", "2026-10-27").top).toBe("Morgen");
    expect(dayLabel("2026-10-30", "2026-10-27").top).toBe("Fr");
    expect(upcoming(["2026-10-26", "2026-10-27"], "2026-10-27")).toEqual(["2026-10-27"]);
    expect(ageMinutes("2026-10-27T17:00:00Z", Date.parse("2026-10-27T17:06:00Z"))).toBe(6);
    expect(standLabel("2026-10-27T17:00:00Z")).toContain("18:00");
    expect(viennaNow(new Date("2026-10-27T23:30:00Z"))).toEqual({ date: "2026-10-28", minute: 30 });
  });
  it("links", () => {
    const v = venue({ address: "Straße 1" });
    expect(mapLink(v)).toContain(encodeURIComponent("Venue, Straße 1"));
    expect(mapLink(venue())).toBeNull();
    expect(bookingLink(v, "2026-10-27")).toBe("https://book/27");
    expect(bookingLink(v, "2026-11-01")).toBe("https://book/27");
    expect(bookingLink(venue({ links: {} }), "x")).toBe("#");
  });
});
