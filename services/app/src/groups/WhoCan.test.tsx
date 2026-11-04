import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { answer, problem, serve } from "../test/fetch";
import { renderWithQuery } from "../test/render";
import { blocks, overlay, WhoCan, WhoCanLink, WhoCanPage, whyLong, whyShort } from "./WhoCan";

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

// 19:00 fits; 19:30 has a hall free that too few drive to.
const fours = {
  takenAt: "2026-11-04T17:00:00Z",
  need: 4,
  halfHours: [
    { day: "2026-11-04", start: 1140, fits: true, venues: [] },
    { day: "2026-11-04", start: 1170, fits: false, why: "venues", venues: ["Padel Villach"] },
  ],
};

describe("why it does not fit", () => {
  const h = (why: string, venues: string[] = []) => ({
    day: "2026-11-04",
    start: 1140,
    fits: false,
    why: why as "short",
    venues,
  });
  it("says it shortly and in a sentence", () => {
    expect(whyShort(h("short"), "alle")).toBe("Zu viert zu kurz");
    expect(whyShort(h("area"), "halle")).toBe("Nur draußen frei");
    expect(whyShort(h("area"), "freiluft")).toBe("Nur in der Halle frei");
    expect(whyShort(h("none"), "alle")).toBe("Kein Platz frei");
    expect(whyLong(h("area", ["Wörthersee", "Velden", "Krumpendorf"]), "halle")).toBe(
      "In der Halle ist kein Platz frei, draußen schon: Wörthersee, Velden und Krumpendorf. Ihr spielt nur in der Halle.",
    );
    expect(whyLong(h("area", ["Halle"]), "freiluft")).toMatch(/^Draußen ist kein Platz frei/);
    expect(whyLong(h("none", ["Moosburg"]), "alle")).toMatch(
      /Moosburg nimmt für diesen Tag noch keine Buchungen an/,
    );
    expect(whyLong(h("none", ["A", "B"]), "alle")).toMatch(/A und B nehmen/);
    expect(whyLong(h("none"), "alle")).toBe("Keine Anlage hat dann einen frei.");
    expect(whyLong(h("short"), "alle")).toMatch(/nicht eine ganze Stunde/);
  });
});

describe("WhoCan", () => {
  it("marks where four can without a court red and says why", async () => {
    serve({
      "GET /api/v1/groups/1/availability": () => answer(200, win),
      "GET /api/v1/groups/1/fours": () => answer(200, fours),
    });
    renderWithQuery(<WhoCan group={1} area="halle" />);
    const days = await screen.findAllByRole("button", {
      name: "Mi 4.11.: bis zu 4 von 5, teils ohne passenden Platz",
    });
    const cells = days[0]!.querySelectorAll("span.grid > span");
    expect(cells[(19 * 60 - 420) / 30]).not.toHaveAttribute("data-miss");
    expect(cells[(19 * 60 + 30 - 420) / 30]).toHaveAttribute("data-miss", "true");
    fireEvent.mouseEnter(cells[(19 * 60 + 30 - 420) / 30]!);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Zu wenige fahren hin");
    expect(screen.getByText("4+, kein passender Platz")).toBeInTheDocument();

    await userEvent.click(days[1]!);
    const sheet = screen.getByRole("dialog", { name: "Mi 4.11." });
    expect(sheet).toHaveTextContent("19:00–19:304Seb, Anna, markus, LisaPlatz frei");
    expect(sheet).toHaveTextContent(
      "19:30–20:004Seb, Anna, markus, LisaZu wenige fahren hin. Frei wäre ein Platz in Padel Villach",
    );
    expect(within(sheet).getByRole("link", { name: "Wann passt es für vier?" })).toHaveAttribute(
      "href",
      "/groups/1/fits",
    );
  });

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

describe("WhoCanPage", () => {
  const group = (how: string) => ({
    id: 1,
    name: "Runde",
    kind: "private",
    area: "halle",
    how,
    role: "member",
    members: 5,
    requested: false,
    memberList: [],
    invitations: [],
    requests: [],
  });
  const page = () =>
    renderWithQuery(
      <Routes>
        <Route path="/groups/:id/who-can" element={<WhoCanPage />} />
      </Routes>,
      { at: "/groups/1/who-can" },
    );

  it("is its own page under the group, linked from the group's page", async () => {
    serve({
      "GET /api/v1/me": () =>
        answer(200, { email: "seb@example.at", name: "Seb", canInvite: true }),
      "GET /api/v1/groups/1": () => answer(200, group("member")),
      "GET /api/v1/groups/1/availability": () => answer(200, win),
      "GET /api/v1/groups/1/fours": () => answer(200, fours),
    });
    page();
    expect(await screen.findByRole("heading", { name: "Wer kann wann" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Runde" })).toHaveAttribute("href", "/groups/1");
    expect(
      await screen.findAllByRole("button", { name: /Mi 4\.11\.: bis zu 4 von 5/ }),
    ).toHaveLength(2);

    renderWithQuery(<WhoCanLink group={1} />);
    expect(screen.getByRole("link", { name: /Wer kann wann/ })).toHaveAttribute(
      "href",
      "/groups/1/who-can",
    );
  });

  it("is only for members", async () => {
    serve({
      "GET /api/v1/me": () => answer(200, { email: "eva@example.at", name: "", canInvite: false }),
      "GET /api/v1/groups/1": () => answer(200, group("open")),
    });
    page();
    expect(await screen.findByText(/sieht nur, wer in der Gruppe ist/)).toBeInTheDocument();
  });
});
