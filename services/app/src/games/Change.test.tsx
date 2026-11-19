import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import type { Game as G, Move } from "../api/client";
import { answer, problem, serve, type Sent } from "../test/fetch";
import { renderWithQuery } from "../test/render";
import { Game } from "./Game";
import { Waiting } from "./Waiting";

const p = (email: string, name = "") => ({ email, name });
const seb = p("seb@example.at", "Seb");
const anna = p("anna@example.at", "Anna");
const markus = p("markus@example.at", "Markus");
const lisa = p("lisa@example.at", "Lisa");
const eva = p("eva@example.at", "Eva");

const game = (over: Partial<G> = {}): G => ({
  id: 7,
  groupId: 1,
  groupName: "Runde",
  venueId: "villach",
  venueName: "Padel Villach",
  court: "Court 1",
  day: "2026-10-29",
  start: 1110,
  minutes: 90,
  players: 4,
  state: "proposed",
  proposedBy: seb,
  lineup: [
    { ...seb, state: "in" },
    { ...anna, state: "in" },
    { ...markus, state: "in" },
    { ...lisa, state: "in" },
    { ...eva, state: "reserve" },
  ],
  ...over,
});

const group = {
  id: 1,
  name: "Runde",
  kind: "private",
  area: "alle",
  how: "member",
  role: "admin",
  members: 5,
  requested: false,
  memberList: [seb, anna, markus, lisa, eva].map((m) => ({
    ...m,
    role: "member",
    joinedAt: "2026-10-28T07:00:00Z",
    daysEntered: 1,
  })),
  invitations: [],
  requests: [],
};

const day = (d: string, from: number, to: number) => ({
  day: d,
  spans: [{ from, to }],
  declined: false,
});
const times = {
  from: "2026-10-28",
  to: "2026-11-10",
  members: [
    { ...anna, days: [day("2026-10-29", 1020, 1260)] },
    { ...markus, days: [{ day: "2026-10-29", spans: [], declined: true }] },
    { ...lisa, days: [] },
  ],
};

const mv = (over: Partial<Move>): Move => ({
  day: "2026-10-29",
  start: 1170,
  minutes: 90,
  venueId: "villach",
  venueName: "Padel Villach",
  court: "Court 1",
  perHead: { amount: 1300, currency: "EUR" },
  ...over,
});
const moves = [
  mv({ start: 1110, court: "Court 3" }),
  mv({ start: 1170 }),
  mv({
    day: "2026-10-30",
    start: 1080,
    venueId: "arena",
    venueName: "Arena One",
    court: "Court 2",
  }),
];

function at(route = "/games/7") {
  return renderWithQuery(
    <Routes>
      <Route path="/games/:id" element={<Game />} />
    </Routes>,
    { at: route },
  );
}

function routes(get: () => G, set: (g: G) => void, me = seb) {
  return {
    "GET /api/v1/me": () => answer(200, { ...me, canInvite: false }),
    "GET /api/v1/games/7": () => answer(200, get()),
    "GET /api/v1/groups/1": () => answer(200, group),
    "GET /api/v1/groups/1/availability": () => answer(200, times),
    "GET /api/v1/games/7/moves": (sent: Sent) =>
      answer(200, {
        takenAt: "2026-10-29T15:00:00Z",
        moves: moves.filter((m) => String(m.minutes) === sent.url.searchParams.get("minutes")),
      }),
    "PATCH /api/v1/games/7": (sent: Sent) => {
      const b = sent.body as {
        move?: Move;
        note?: string;
        remove?: string;
      };
      const g = get();
      if (b.move) {
        const courtOnly = b.move.day === g.day && b.move.start === g.start;
        set({
          ...g,
          ...b.move,
          change: {
            at: "2026-10-29T15:00:00Z",
            day: g.day,
            start: g.start,
            minutes: g.minutes,
            venueName: g.venueName,
            court: g.court,
            ...(b.note ? { note: b.note } : {}),
          },
          lineup: courtOnly
            ? g.lineup
            : g.lineup.map((x) =>
                x.state === "in" && x.email !== seb.email ? { ...x, state: "asked" } : x,
              ),
        });
      }
      if (b.remove)
        set({
          ...g,
          lineup: g.lineup.map((x) =>
            x.email === b.remove
              ? { ...x, state: "out" }
              : x.state === "reserve"
                ? { ...x, state: "in" }
                : x,
          ),
        });
      return answer(200, get());
    },
  };
}

describe("Changing a game", () => {
  it("moves it to another time, and the others say again", async () => {
    let g = game();
    const calls: Sent[] = [];
    serve(
      routes(
        () => g,
        (n) => (g = n),
      ),
      calls,
    );
    at();
    await userEvent.click(await screen.findByRole("button", { name: "Ändern" }));
    const menu = await screen.findByRole("dialog");
    expect(menu).toHaveTextContent("4 von 4 Plätzen vergeben");
    await userEvent.click(within(menu).getByRole("button", { name: /Zeit oder Ort ändern/ }));

    const sheet = await screen.findByRole("dialog", { name: "Zeit oder Ort ändern" });
    expect(await within(sheet).findByText("Gleiche Zeit, anderer Platz")).toBeInTheDocument();
    expect(within(sheet).getByText("Alle bleiben dabei")).toBeInTheDocument();
    // 19:30 on the same day: Anna has time, Markus said no, Lisa entered nothing.
    const later = within(sheet).getByRole("button", { name: /Do 29\.10\. 19:30–21:00/ });
    expect(later).toHaveTextContent("✓ Anna");
    expect(later).toHaveTextContent("? Lisa");
    expect(later).toHaveTextContent("€ 13 pro Kopf");
    // Another day.
    await userEvent.click(within(sheet).getByRole("button", { name: "Fr 30.10." }));
    expect(within(sheet).getByRole("button", { name: /Arena One/ })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Do 29.10." }));
    // Another length asks again.
    await userEvent.click(within(sheet).getByRole("button", { name: "60 Min" }));
    expect(
      await within(sheet).findByText("In den nächsten Tagen ist kein Platz für so lange frei."),
    ).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "90 Min" }));

    await userEvent.click(await within(sheet).findByRole("button", { name: /19:30–21:00/ }));
    const confirm = await screen.findByRole("dialog", { name: "Spiel verschieben" });
    expect(confirm).toHaveTextContent("Neu zusagen");
    expect(confirm).toHaveTextContent("Annahätte Zeit");
    expect(confirm).toHaveTextContent("Markuslaut „Wann kann ich?“ nicht frei");
    expect(confirm).toHaveTextContent("Lisanichts eingetragen");
    expect(confirm).toHaveTextContent(
      "Anna, Markus, Lisa und Eva bekommen eine Mitteilung. Eva bleibt Ersatz.",
    );
    await userEvent.type(within(confirm).getByLabelText(/Nachricht an alle/), "Sorry!");
    await userEvent.click(within(confirm).getByRole("button", { name: "Verschieben" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      await screen.findByRole("heading", { name: "Do 29.10., 19:30–21:00" }),
    ).toBeInTheDocument();
    const note = screen.getByText("Du hast das Spiel verschoben").parentElement!;
    expect(note).toHaveTextContent("Vorher: Do 29.10., 18:30–20:00 · Court 1");
    expect(note).toHaveTextContent("„Sorry!“");
    expect(screen.getByText("Warten auf Anna, Markus und Lisa")).toBeInTheDocument();
    expect(screen.getByText(/Neu gefragt:/).parentElement).toHaveTextContent("Anna, Markus, Lisa");
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([
      {
        move: { venueId: "villach", court: "Court 1", day: "2026-10-29", start: 1170, minutes: 90 },
        note: "Sorry!",
      },
    ]);
  });

  it("changes only the court, and everyone stays in", async () => {
    let g = game({ state: "booked" });
    serve(
      routes(
        () => g,
        (n) => (g = n),
      ),
    );
    at();
    await userEvent.click(await screen.findByRole("button", { name: "Ändern" }));
    await userEvent.click(await screen.findByRole("button", { name: /Zeit oder Ort ändern/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Court 3/ }));
    const confirm = await screen.findByRole("dialog", { name: "Platz wechseln" });
    expect(confirm).toHaveTextContent("bleiben alle dabei");
    expect(confirm).not.toHaveTextContent("Du hast schon gebucht");
    await userEvent.click(within(confirm).getByRole("button", { name: "Zurück" }));
    await userEvent.click(await screen.findByRole("button", { name: /Court 3/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Platz wechseln" }));
    expect(await screen.findByText("Du hast den Platz gewechselt")).toBeInTheDocument();
    expect(screen.getByText(/Vorher:/)).toHaveTextContent("Vorher: Court 1");
  });

  it("says when the court went meanwhile, or nothing is known yet", async () => {
    const g = game({ state: "booked" });
    serve({
      ...routes(
        () => g,
        () => {},
      ),
      "PATCH /api/v1/games/7": () => problem(409, "court-gone"),
    });
    at();
    await userEvent.click(await screen.findByRole("button", { name: "Ändern" }));
    await userEvent.click(await screen.findByRole("button", { name: /Zeit oder Ort ändern/ }));
    await userEvent.click(await screen.findByRole("button", { name: /19:30–21:00/ }));
    expect(await screen.findByText("Du hast schon gebucht")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Verschieben" }));
    // Back on a fresh list.
    expect(await screen.findByRole("dialog", { name: "Zeit oder Ort ändern" })).toBeInTheDocument();
  });

  it("says when there are no court data", async () => {
    const g = game();
    serve({
      ...routes(
        () => g,
        () => {},
      ),
      "GET /api/v1/games/7/moves": () => problem(503, "no-snapshot"),
    });
    at();
    await userEvent.click(await screen.findByRole("button", { name: "Ändern" }));
    await userEvent.click(await screen.findByRole("button", { name: /Zeit oder Ort ändern/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Plätze wurden noch nicht abgefragt.",
    );
  });

  it("takes someone out, and the reserve moves up", async () => {
    let g = game();
    const calls: Sent[] = [];
    serve(
      routes(
        () => g,
        (n) => (g = n),
      ),
      calls,
    );
    at();
    await userEvent.click(await screen.findByRole("button", { name: "Ändern" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Spieler/ }));
    const sheet = await screen.findByRole("dialog", { name: "Spieler" });
    expect(within(sheet).queryByRole("button", { name: "Seb herausnehmen" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("button", { name: "Eva herausnehmen" }));
    expect(sheet).toHaveTextContent("wartet dann nicht mehr");
    await userEvent.click(within(sheet).getByRole("button", { name: "Abbrechen" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Lisa herausnehmen" }));
    expect(sheet).toHaveTextContent("Eva rückt als Ersatz nach und bekommt Bescheid.");
    await userEvent.click(within(sheet).getByRole("button", { name: "Herausnehmen" }));
    await waitFor(() => expect(within(sheet).queryByText("Lisa herausnehmen?")).toBeNull());
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([
      { remove: "lisa@example.at" },
    ]);
  });

  it("asks whoever was in again, on the game and on Spielen", async () => {
    const moved = game({
      start: 1170,
      change: {
        at: "2026-10-29T15:00:00Z",
        day: "2026-10-29",
        start: 1110,
        minutes: 90,
        venueName: "Arena One",
        court: "Court 4",
        note: "Platz war weg",
      },
      lineup: [
        { ...seb, state: "in" },
        { ...anna, state: "asked" },
        { ...markus, state: "in" },
      ],
    });
    const calls: Sent[] = [];
    serve(
      {
        ...routes(
          () => moved,
          () => {},
          anna,
        ),
        "GET /api/v1/games": () => answer(200, { items: [moved] }),
        "PUT /api/v1/games/7/players/me": () => answer(200, moved),
      },
      calls,
    );
    const a = at();
    const note = await screen.findByRole("status");
    expect(note).toHaveTextContent("Seb hat das Spiel verschoben");
    expect(note).toHaveTextContent("Vorher: Do 29.10., 18:30–20:00 · Arena One · Court 4");
    expect(note).toHaveTextContent("„Platz war weg“");
    expect(screen.queryByRole("button", { name: "Ändern" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Kann doch nicht" })).toBeNull();
    await userEvent.click(within(note).getByRole("button", { name: "Passt mir" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ answer: "in" });
    a.unmount();

    renderWithQuery(<Waiting />);
    expect(await screen.findByText("Verschoben · passt es dir noch?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Passt mir" })).toBeInTheDocument();
  });
});
