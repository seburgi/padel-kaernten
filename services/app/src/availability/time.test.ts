import { describe, expect, it } from "vitest";
import { clock, dayLabel, daysBetween, GRID, merge, spansText, weekday } from "./time";

describe("time", () => {
  it("draws the grid and clock times", () => {
    expect(GRID[0]).toBe(360);
    expect(GRID[GRID.length - 1]).toBe(1440);
    expect(GRID).toHaveLength(37);
    expect(clock(420)).toBe("7:00");
    expect(clock(1110)).toBe("18:30");
    expect(clock(1440)).toBe("24:00");
    expect(spansText([])).toBe("");
    expect(
      spansText([
        { from: 420, to: 540 },
        { from: 1110, to: 1320 },
      ]),
    ).toBe("7:00–9:00, 18:30–22:00");
  });

  it("merges like the API", () => {
    expect(
      merge([
        { from: 1110, to: 1320 },
        { from: 420, to: 540 },
        { from: 540, to: 600 },
        { from: 700, to: 700 },
        { from: 1200, to: 1260 },
      ]),
    ).toEqual([
      { from: 420, to: 600 },
      { from: 1110, to: 1320 },
    ]);
  });

  it("counts days and names them", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    // 2026-10-29 is a Thursday, 2026-11-01 a Sunday.
    expect(weekday("2026-10-29")).toBe(4);
    expect(weekday("2026-11-01")).toBe(7);
    expect(dayLabel("2026-10-29")).toBe("Do 29.10.");
    expect(dayLabel("2026-11-02")).toBe("Mo 2.11.");
  });
});
