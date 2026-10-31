import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { answer, problem, serve } from "../test/fetch";
import { renderWithQuery } from "../test/render";
import { blocks, overlay, WhoCan } from "./WhoCan";

const evening = { from: 18 * 60, to: 21 * 60 };
const members = [
  {
    email: "seb@example.at",
    name: "Seb",
    days: [{ day: "2026-11-04", spans: [{ from: 18 * 60, to: 22 * 60 }], declined: false }],
  },
  {
    email: "anna@example.at",
    name: "Anna",
    days: [{ day: "2026-11-04", spans: [evening], declined: false }],
  },
  {
    email: "markus@example.at",
    name: "",
    days: [{ day: "2026-11-04", spans: [{ from: 19 * 60, to: 21 * 60 }], declined: false }],
  },
  {
    email: "lisa@example.at",
    name: "Lisa",
    days: [
      { day: "2026-11-03", spans: [], declined: true },
      { day: "2026-11-04", spans: [{ from: 19 * 60, to: 20 * 60 }], declined: false },
    ],
  },
  { email: "eva@example.at", name: "Eva", days: [] },
];
const win = { from: "2026-10-31", to: "2026-11-13", members };

describe("overlay and blocks", () => {
  it("counts who can every half hour and joins the same people into blocks", () => {
    const days = overlay(win.from, win.to, members);
    expect(days).toHaveLength(14);
    const wed = days.find((d) => d.day === "2026-11-04")!;
    expect(wed.can[(19 * 60 - 420) / 30]).toEqual(["Seb", "Anna", "markus", "Lisa"]);
    expect(wed.open).toEqual(["Eva"]);
    expect(days.find((d) => d.day === "2026-11-03")!.declined).toEqual(["Lisa"]);
    // Shown from 7 to 22: Seb's last half hour, 21:30 to 22:00, is the last cell.
    expect(wed.can).toHaveLength(30);
    expect(wed.can[29]).toEqual(["Seb"]);
    expect(blocks(wed).map((b) => [b.from, b.to, b.who.length])).toEqual([
      [1080, 1140, 2],
      [1140, 1200, 4],
      [1200, 1260, 3],
      [1260, 1320, 1],
    ]);
  });
});

describe("WhoCan", () => {
  it("names who can on hover and opens a day with its blocks", async () => {
    serve({ "GET /api/v1/groups/1/availability": () => answer(200, win) });
    renderWithQuery(<WhoCan group={1} />);
    const days = await screen.findAllByRole("button", { name: "Mi 4.11.: bis zu 4 von 5" });
    expect(days).toHaveLength(2); // wide and phone

    const cells = days[0]!.querySelectorAll("span.grid > span");
    fireEvent.mouseEnter(cells[(19 * 60 - 420) / 30]!);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Mi 4.11. · 19:00–19:304 von 5: Seb, Anna, markus, Lisa",
    );

    await userEvent.click(days[1]!);
    const sheet = screen.getByRole("dialog", { name: "Mi 4.11." });
    expect(within(sheet).getByText("Seb, Anna, markus, Lisa")).toBeInTheDocument();
    expect(within(sheet).getByText(/Ab vier passt es/)).toBeInTheDocument();
    expect(sheet).toHaveTextContent("Noch offen: Eva");
    await userEvent.click(within(sheet).getByRole("button", { name: "Schließen" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says when nobody entered a time, and when it cannot load", async () => {
    serve({
      "GET /api/v1/groups/1/availability": () =>
        answer(200, { ...win, members: [{ ...members[4]! }] }),
      "GET /api/v1/groups/2/availability": () => problem(500, "internal"),
    });
    renderWithQuery(<WhoCan group={1} />);
    expect(await screen.findByText(/Noch hat niemand Zeiten eingetragen/)).toBeInTheDocument();
    renderWithQuery(<WhoCan group={2} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("konnte nicht geladen werden");
  });
});
