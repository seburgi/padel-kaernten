import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import type { Fit, Game as G } from "../api/client";
import { answer, problem, serve, type Sent } from "../test/fetch";
import { renderWithQuery } from "../test/render";
import { Fits } from "./Fits";
import { Game } from "./Game";
import { byTime, clock, dayLabel, errorText, euros, names, shown, span } from "./games";
import { Upcoming } from "./Upcoming";
import { ApiError } from "../api/client";

const p = (email: string, name = "") => ({ email, name });
const seb = p("seb@example.at", "Seb");
const anna = p("anna@example.at", "Anna");
const markus = p("markus@example.at");
const lisa = p("lisa@example.at", "Lisa");
const eva = p("eva@example.at", "Eva");

const fit = (over: Partial<Fit> = {}): Fit => ({
  day: "2026-10-29",
  start: 1110,
  minutes: 90,
  venueId: "villach",
  venueName: "Padel Villach",
  court: "Court 1",
  price: { amount: 6000, currency: "EUR" },
  perHead: { amount: 1500, currency: "EUR" },
  can: [seb, anna, markus, lisa],
  ask: [],
  ...over,
});

const game = (over: Partial<G> = {}): G => ({
  id: 7,
  groupId: 1,
  groupName: "Padel Kärnten",
  venueId: "villach",
  venueName: "Padel Villach",
  court: "Court 1",
  day: "2026-10-29",
  start: 1110,
  minutes: 90,
  players: 4,
  price: { amount: 6000, currency: "EUR" },
  perHead: { amount: 1500, currency: "EUR" },
  link: "https://book.example/29",
  state: "proposed",
  proposedBy: seb,
  lineup: [{ ...seb, state: "in" }],
  ...over,
});

const group = {
  id: 1,
  name: "Padel Kärnten",
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

const fresh = () => new Date().toISOString();

function at(path: string, element: React.ReactNode, route: string) {
  return renderWithQuery(
    <Routes>
      <Route path={route} element={element} />
      <Route path="*" element={<p>woanders</p>} />
    </Routes>,
    { at: path },
  );
}

describe("games helpers", () => {
  it("writes times, money and names", () => {
    expect(dayLabel("2026-10-29")).toBe("Do 29.10.");
    expect(clock(1110)).toBe("18:30");
    expect(span(1110, 90)).toBe("18:30–20:00");
    expect(euros(1500)).toMatch(/15/);
    expect(euros(1650)).toMatch(/16,50/);
    expect(shown(markus)).toBe("markus");
    expect(shown(anna)).toBe("Anna");
    expect(errorText(new ApiError(503, "no-snapshot"))).toMatch(/noch nicht abgefragt/);
    expect(errorText(new Error("x"))).toMatch(/nicht geklappt/);
    expect(names([])).toBe("");
    expect(names([anna, lisa])).toBe("Anna und Lisa");
    expect(names([anna, eva, lisa])).toBe("Anna, Eva und Lisa");
  });

  it("sorts those without an answer by their times", () => {
    const g = { day: "2026-10-29", start: 1110, minutes: 90 };
    const on = (spans: { from: number; to: number }[], declined = false) => [
      { day: "2026-10-29", spans, declined },
    ];
    expect(byTime(g, [anna, lisa], undefined)).toEqual({
      free: [],
      busy: [],
      unknown: [anna, lisa],
    });
    const r = byTime(
      g,
      [anna, markus, lisa, eva],
      [
        { ...anna, days: on([{ from: 1110, to: 1200 }]) },
        {
          ...markus,
          days: on([
            { from: 1140, to: 1260 },
            { from: 1080, to: 1140 },
          ]),
        },
        { ...lisa, days: on([], true) },
        {
          ...eva,
          days: [{ day: "2026-10-30", spans: [{ from: 360, to: 1440 }], declined: false }],
        },
      ],
    );
    expect(r).toEqual({ free: [anna, markus], busy: [lisa], unknown: [eva] });
    expect(
      byTime(
        g,
        [anna],
        [
          {
            ...anna,
            days: on([
              { from: 1110, to: 1140 },
              { from: 1170, to: 1200 },
            ]),
          },
        ],
      ),
    ).toEqual({ free: [], busy: [anna], unknown: [] });
  });
});

describe("Fits", () => {
  it("lists fits by day, near misses, and proposes one", async () => {
    const calls: Sent[] = [];
    let gone = true;
    serve(
      {
        "GET /api/v1/groups/1/fits": (sent) =>
          answer(200, {
            takenAt: fresh(),
            need: 4,
            fits:
              sent.url.searchParams.get("minutes") === "120"
                ? []
                : [
                    fit({ day: "2026-10-30", start: 1080 }),
                    fit(),
                    fit({
                      venueId: "annenheim",
                      venueName: "Annenheim",
                      court: "Platz 1",
                      perHead: undefined,
                      price: undefined,
                    }),
                  ],
            nearly: [fit({ start: 1200, can: [seb, anna, markus], ask: [lisa, eva] })],
          }),
        "GET /api/v1/groups/1": () => answer(200, group),
        "POST /api/v1/groups/1/games": () => {
          if (gone) {
            gone = false;
            return problem(409, "court-gone");
          }
          return answer(201, game());
        },
      },
      calls,
    );
    const { router } = at("/groups/1/fits", <Fits />, "/groups/:id/fits");
    expect(
      await screen.findByRole("heading", { name: "Wann passt es für vier?" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "← Padel Kärnten" })).toBeInTheDocument();
    const days = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(days.slice(0, 2)).toEqual(["Do 29.10.", "Fr 30.10."]);
    // The same time and people at two venues is one card, the cheaper first.
    expect(screen.getAllByText("4 können: Seb, Anna, markus, Lisa")).toHaveLength(2);
    const both = screen.getByText("2 Anlagen frei").closest("li")!;
    expect(
      within(both)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual([
      "Do 29.10. 18:30 in Padel Villach vorschlagen",
      "Do 29.10. 18:30 in Annenheim vorschlagen",
    ]);
    expect(screen.getAllByText("2 Anlagen frei")).toHaveLength(1);
    expect(screen.getByText(/Frag Lisa oder Eva/)).toBeInTheDocument();
    // A fresh snapshot is not asked for again.
    expect(calls.some((c) => c.url.pathname === "/api/v1/slots/refresh")).toBe(false);

    const first = screen.getByRole("button", {
      name: "Do 29.10. 18:30 in Padel Villach vorschlagen",
    });
    await userEvent.click(first);
    expect(await screen.findByText(/Der Platz ist inzwischen weg/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Do 29.10. 18:30 in Padel Villach vorschlagen" }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/games/7"));
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts[1]!.body).toEqual({
      venueId: "villach",
      court: "Court 1",
      day: "2026-10-29",
      start: 1110,
      minutes: 90,
    });
    expect(posts[0]!.headers.get("Idempotency-Key")).toBe(posts[1]!.headers.get("Idempotency-Key"));
  });

  it("proposes a near miss, with the fourth place left open", async () => {
    const calls: Sent[] = [];
    let gone = true;
    serve(
      {
        "GET /api/v1/groups/1/fits": () =>
          answer(200, {
            takenAt: fresh(),
            need: 4,
            fits: [],
            nearly: [fit({ start: 1200, can: [seb, anna, markus], ask: [lisa] })],
          }),
        "GET /api/v1/groups/1": () => answer(200, group),
        "POST /api/v1/groups/1/games": () => {
          if (gone) {
            gone = false;
            return problem(409, "court-gone");
          }
          return answer(201, game());
        },
      },
      calls,
    );
    const { router } = at("/groups/1/fits", <Fits />, "/groups/:id/fits");
    expect(await screen.findByText(/bleibt ein Platz frei/)).toBeInTheDocument();
    const name = "Do 29.10. 20:00 in Padel Villach zu dritt vorschlagen";
    await userEvent.click(screen.getByRole("button", { name }));
    const near = screen.getByRole("heading", { name: "Fast: eine Person fehlt" }).parentElement!;
    expect(await within(near).findByText(/Der Platz ist inzwischen weg/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/games/7"));
    expect(calls.filter((c) => c.method === "POST")[1]!.body).toEqual({
      venueId: "villach",
      court: "Court 1",
      day: "2026-10-29",
      start: 1200,
      minutes: 90,
    });
  });

  it("changes the length, and says when nothing fits", async () => {
    serve({
      "GET /api/v1/groups/1/fits": () =>
        answer(200, { takenAt: fresh(), need: 4, fits: [], nearly: [] }),
      "GET /api/v1/groups/1": () => problem(500, "internal"),
    });
    at("/groups/1/fits", <Fits />, "/groups/:id/fits");
    expect(await screen.findByText(/Gerade passt nichts für vier/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "120 Min" }));
    expect(screen.getByRole("button", { name: "120 Min" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "← Gruppe" })).toBeInTheDocument();
    expect(screen.queryByText(/Fast/)).toBeNull();
  });

  it("asks the venues again when the courts are old or missing", async () => {
    let snapshot = false;
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/groups/1/fits": () =>
          snapshot
            ? answer(200, { takenAt: fresh(), need: 4, fits: [fit()], nearly: [] })
            : problem(503, "no-snapshot"),
        "GET /api/v1/groups/1": () => answer(200, group),
        "POST /api/v1/slots/refresh": () => {
          snapshot = true;
          return answer(200, { takenAt: fresh(), days: [], venues: [] });
        },
      },
      calls,
    );
    at("/groups/1/fits", <Fits />, "/groups/:id/fits");
    expect(await screen.findByText("4 können: Seb, Anna, markus, Lisa")).toBeInTheDocument();
    expect(calls.filter((c) => c.url.pathname === "/api/v1/slots/refresh")).toHaveLength(1);
  });

  it("refreshes a stale snapshot once, and says when fits do not load", async () => {
    const calls: Sent[] = [];
    let up = true;
    serve(
      {
        "GET /api/v1/groups/1/fits": () =>
          up
            ? answer(200, { takenAt: "2026-10-28T06:00:00Z", need: 4, fits: [], nearly: [] })
            : problem(500, "internal"),
        "GET /api/v1/groups/1": () => answer(200, group),
        "POST /api/v1/slots/refresh": () => {
          up = false;
          return problem(502, "sites-failed");
        },
      },
      calls,
    );
    at("/groups/1/fits", <Fits />, "/groups/:id/fits");
    expect(
      await screen.findByText("Die passenden Zeiten konnten nicht geladen werden."),
    ).toBeInTheDocument();
    up = true;
    await userEvent.click(screen.getByRole("button", { name: "Nochmal versuchen" }));
    expect(await screen.findByText(/Gerade passt nichts/)).toBeInTheDocument();
    expect(calls.filter((c) => c.url.pathname === "/api/v1/slots/refresh")).toHaveLength(1);
  });

  it("says where the group plays, and where to change it", async () => {
    serve({
      "GET /api/v1/groups/1/fits": () =>
        answer(200, { takenAt: fresh(), need: 4, fits: [], nearly: [] }),
      "GET /api/v1/groups/1": () => answer(200, { ...group, area: "halle" }),
    });
    at("/groups/1/fits", <Fits />, "/groups/:id/fits");
    expect(await screen.findByText(/Nur Halle \(mit überdachten Plätzen\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ändern" })).toHaveAttribute(
      "href",
      "/groups/1/settings",
    );
  });

  it("is for members only", async () => {
    serve({
      "GET /api/v1/groups/1/fits": () => problem(404, "no-group"),
      "GET /api/v1/groups/1": () => problem(404, "no-group"),
    });
    at("/groups/1/fits", <Fits />, "/groups/:id/fits");
    expect(await screen.findByRole("heading", { name: "Keine Gruppe" })).toBeInTheDocument();
  });
});

describe("Game", () => {
  it("lets the proposer book and cancel", async () => {
    let g = game({
      lineup: [
        { ...seb, state: "in" },
        { ...anna, state: "in" },
        { ...markus, state: "in" },
        { ...lisa, state: "in" },
        { ...eva, state: "reserve" },
      ],
    });
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/me": () => answer(200, { ...seb, canInvite: true }),
        "GET /api/v1/games/7": () => answer(200, g),
        "GET /api/v1/groups/1": () => answer(200, group),
        "PATCH /api/v1/games/7": (sent) => {
          g = { ...g, state: (sent.body as { state: string }).state };
          return answer(200, g);
        },
      },
      calls,
    );
    at("/games/7", <Game notify={<p>Mitteilungen?</p>} />, "/games/:id");
    expect(
      await screen.findByRole("heading", { name: "Do 29.10., 18:30–20:00" }),
    ).toBeInTheDocument();
    // Whoever is in is asked about Mitteilungen.
    expect(screen.getByText("Mitteilungen?")).toBeInTheDocument();
    expect(screen.getByText(/Padel Villach · Court 1/)).toHaveTextContent("pro Kopf");
    expect(screen.getByText("Ihr seid vier. Du buchst jetzt.")).toBeInTheDocument();
    expect(screen.getByText(/Vorgeschlagen von/)).toHaveTextContent("Vorgeschlagen von dir");
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent(
      "Du buchst bei Padel Villach",
    );
    expect(screen.getByText("Seb (du)")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ersatz" }).parentElement).toHaveTextContent(
      "EvaAufnehmen",
    );
    expect(screen.getByRole("link", { name: "Zur Buchung" })).toHaveAttribute(
      "href",
      "https://book.example/29",
    );
    await userEvent.click(screen.getByRole("button", { name: "Gebucht" }));
    expect(await screen.findByText(/vorgeschlagen von dir/)).toHaveTextContent("Gebucht");
    expect(screen.queryByRole("button", { name: "Gebucht" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Spiel absagen …" }));
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    await userEvent.click(screen.getByRole("button", { name: "Spiel absagen …" }));
    await userEvent.click(screen.getByRole("button", { name: "Spiel absagen" }));
    expect(await screen.findByText("Abgesagt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /dabei|Kann/ })).toBeNull();
    expect(screen.queryByText(/Noch keine Antwort/)).toBeNull();
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([
      { state: "booked" },
      { state: "cancelled" },
    ]);
  });

  it("lets the proposer change the places and take a reserve in", async () => {
    let g = game({
      lineup: [
        { ...seb, state: "in" },
        { ...anna, state: "in" },
        { ...markus, state: "in" },
        { ...lisa, state: "in" },
        { ...eva, state: "reserve" },
      ],
    });
    let fail = true;
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/me": () => answer(200, { ...seb, canInvite: true }),
        "GET /api/v1/games/7": () => answer(200, g),
        "GET /api/v1/groups/1": () => answer(200, group),
        "PATCH /api/v1/games/7": (sent) => {
          const body = sent.body as { players?: number; accept?: string };
          if (body.players === 6 && fail) {
            fail = false;
            return problem(409, "places");
          }
          if (body.accept)
            g = {
              ...g,
              players: 5,
              perHead: { amount: 1200, currency: "EUR" },
              lineup: g.lineup.map((x) => (x.email === body.accept ? { ...x, state: "in" } : x)),
            };
          else g = { ...g, players: body.players! };
          return answer(200, g);
        },
      },
      calls,
    );
    at("/games/7", <Game />, "/games/:id");
    expect(await screen.findByText("Ihr seid vier. Du buchst jetzt.")).toBeInTheDocument();
    // Four are in: no fewer places than that.
    expect(screen.getByRole("button", { name: "Ein Platz weniger" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Aufnehmen" }));
    expect(await screen.findByText("Ihr seid fünf. Du buchst jetzt.")).toBeInTheDocument();
    expect(screen.getByText(/Padel Villach · Court 1/)).toHaveTextContent(/12 pro Kopf/);
    expect(screen.getByRole("img", { name: "5 von 5 dabei" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aufnehmen" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Ein Platz mehr" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("höchstens acht");
    await userEvent.click(screen.getByRole("button", { name: "Ein Platz mehr" }));
    expect(await screen.findByText("Noch 1 gesucht")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent(
      "Sechs sagen zu 5 von 6",
    );
    expect(screen.getByText(/bucht am besten erst/)).toHaveTextContent("wenn ihr sechs seid");
    await userEvent.click(screen.getByRole("button", { name: "Ein Platz weniger" }));
    expect(await screen.findByText("Ihr seid fünf. Du buchst jetzt.")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([
      { accept: eva.email },
      { players: 6 },
      { players: 6 },
      { players: 5 },
    ]);
  });

  it("shows nobody else the places", async () => {
    serve({
      "GET /api/v1/me": () => answer(200, { ...anna, canInvite: false }),
      "GET /api/v1/games/7": () =>
        answer(
          200,
          game({
            players: 2,
            lineup: [
              { ...seb, state: "in" },
              { ...anna, state: "in" },
              { ...lisa, state: "reserve" },
            ],
          }),
        ),
      "GET /api/v1/groups/1": () => answer(200, group),
    });
    at("/games/7", <Game />, "/games/:id");
    expect(await screen.findByText("Ihr seid zwei. Seb bucht jetzt.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Platz/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Aufnehmen" })).toBeNull();
    expect(screen.getByText(/Ersatz:/).parentElement).toHaveTextContent("Ersatz: Lisa");
  });

  it("lets a member say yes and no", async () => {
    let g = game({
      lineup: [
        { ...seb, state: "in" },
        { ...lisa, state: "out" },
      ],
    });
    let fail = true;
    serve({
      "GET /api/v1/me": () => answer(200, { ...anna, canInvite: false }),
      "GET /api/v1/games/7": () => answer(200, g),
      "GET /api/v1/groups/1": () => answer(200, group),
      "PUT /api/v1/games/7/players/me": (sent) => {
        if (fail) {
          fail = false;
          return problem(409, "game-closed");
        }
        const state = (sent.body as { answer: string }).answer;
        g = {
          ...g,
          lineup: [...g.lineup.filter((x) => x.email !== anna.email), { ...anna, state }],
        };
        return answer(200, g);
      },
      "PATCH /api/v1/games/7": () => problem(403, "not-allowed"),
    });
    at("/games/7", <Game />, "/games/:id");
    expect(await screen.findByText("Noch 3 gesucht")).toBeInTheDocument();
    expect(screen.getByText(/Vorgeschlagen von/)).toHaveTextContent("Vorgeschlagen von Seb");
    expect(screen.getByRole("img", { name: "1 von 4 dabei" })).toHaveTextContent("SE???");
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent(
      "Vier sagen zu 1 von 4",
    );
    expect(screen.getByText("Seb bucht bei Padel Villach")).toBeInTheDocument();
    expect(screen.getByText(/Können nicht:/)).toHaveTextContent("Lisa");
    expect(await screen.findByText("Anna, markus, Eva")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Noch keine Antwort" })).toBeInTheDocument();
    expect(screen.queryByText("Buchen")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Bin dabei" }));
    expect(await screen.findByText(/abgesagt oder schon vorbei/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Bin dabei" }));
    await userEvent.click(await screen.findByRole("button", { name: "Kann doch nicht" }));
    expect(await screen.findByRole("button", { name: "Bin dabei" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kann nicht" })).toBeNull();
  });

  it("says who of those without an answer would have time", async () => {
    const g = game({
      lineup: [
        { ...seb, state: "in" },
        { ...lisa, state: "out" },
      ],
    });
    const day = (spans: { from: number; to: number }[], declined = false) => ({
      day: "2026-10-29",
      spans,
      declined,
    });
    serve({
      "GET /api/v1/me": () => answer(200, { ...seb, canInvite: true }),
      "GET /api/v1/games/7": () => answer(200, g),
      "GET /api/v1/groups/1": () => answer(200, group),
      "GET /api/v1/groups/1/availability": () =>
        answer(200, {
          from: "2026-10-28",
          to: "2026-11-10",
          members: [
            // Two touching spans cover 18:30 to 20:00.
            {
              ...anna,
              days: [
                day([
                  { from: 1080, to: 1140 },
                  { from: 1140, to: 1260 },
                ]),
              ],
            },
            // Free, but only until 19:30.
            { ...markus, days: [day([{ from: 1080, to: 1170 }])] },
            { ...eva, days: [] },
          ],
        }),
    });
    at("/games/7", <Game />, "/games/:id");
    expect(await screen.findByText("Anna hätte Zeit")).toBeInTheDocument();
    expect(screen.getByText("Hätte Zeit:").parentElement).toHaveTextContent("Hätte Zeit: Anna");
    expect(screen.getByText(/Da nicht frei:/)).toHaveTextContent("markus");
    expect(screen.getByText(/Nichts eingetragen:/)).toHaveTextContent("Eva");
    expect(screen.getByRole("heading", { name: /Noch keine Antwort/ })).toHaveTextContent(
      "laut „Wann kann ich?“",
    );
  });

  it("offers a reserve place when full, and a plain no", async () => {
    const g = game({
      lineup: [seb, anna, markus, lisa].map((x) => ({ ...x, state: "in" })),
      link: undefined,
      perHead: undefined,
    });
    serve({
      "GET /api/v1/me": () => answer(200, { ...eva, canInvite: false }),
      "GET /api/v1/games/7": () => answer(200, g),
      "GET /api/v1/groups/1": () => problem(500, "internal"),
      "PUT /api/v1/games/7/players/me": () =>
        answer(200, { ...g, lineup: [...g.lineup, { ...eva, state: "out" }] }),
    });
    at("/games/7", <Game />, "/games/:id");
    expect(await screen.findByRole("button", { name: "Als Ersatz dabei" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Kann nicht" }));
    expect(await screen.findByText(/Können nicht:/)).toHaveTextContent("Eva");
  });

  it("says when there is no such game, and when it does not load", async () => {
    let up = false;
    serve({
      "GET /api/v1/me": () => answer(200, { ...anna, canInvite: false }),
      "GET /api/v1/games/8": () => problem(404, "no-game"),
      "GET /api/v1/games/7": () => (up ? answer(200, game()) : problem(500, "internal")),
      "GET /api/v1/groups/1": () => answer(200, group),
    });
    const a = at("/games/8", <Game />, "/games/:id");
    expect(await screen.findByRole("heading", { name: "Kein Spiel" })).toBeInTheDocument();
    a.unmount();
    const b = at("/games/x", <Game />, "/games/:id");
    expect(await screen.findByRole("heading", { name: "Kein Spiel" })).toBeInTheDocument();
    b.unmount();
    at("/games/7", <Game />, "/games/:id");
    expect(await screen.findByText("Das Spiel konnte nicht geladen werden.")).toBeInTheDocument();
    up = true;
    await userEvent.click(screen.getByRole("button", { name: "Nochmal versuchen" }));
    expect(
      await screen.findByRole("heading", { name: "Do 29.10., 18:30–20:00" }),
    ).toBeInTheDocument();
  });

  it("does not push booking while people are missing", async () => {
    const two = game();
    serve({
      "GET /api/v1/me": () => answer(200, { ...seb, canInvite: true }),
      "GET /api/v1/games/7": () => answer(200, { ...two, lineup: two.lineup.slice(0, 2) }),
      "GET /api/v1/groups/1": () => answer(200, group),
    });
    at("/games/7", <Game />, "/games/:id");
    expect(await screen.findByText(/bucht am besten erst, wenn ihr vier seid/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gebucht" })).not.toHaveClass("bg-accent");
  });

  it("says when booking is refused", async () => {
    serve({
      "GET /api/v1/me": () => answer(200, { ...seb, canInvite: true }),
      "GET /api/v1/games/7": () => answer(200, game()),
      "GET /api/v1/groups/1": () => answer(200, group),
      "PATCH /api/v1/games/7": () => problem(403, "not-allowed"),
    });
    at("/games/7", <Game />, "/games/:id");
    await userEvent.click(await screen.findByRole("button", { name: "Gebucht" }));
    expect(await screen.findByText(/nur, wer das Spiel vorgeschlagen hat/)).toBeInTheDocument();
  });
});

describe("Upcoming", () => {
  it("lists every group's games, and one group's", async () => {
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/me": () => answer(200, { ...seb, canInvite: false }),
        "GET /api/v1/games": (sent) =>
          answer(200, {
            items: sent.url.searchParams.get("groupId")
              ? []
              : [
                  game(),
                  game({ id: 8, state: "booked", perHead: undefined, day: "2026-10-30" }),
                  // Spielen shows only the games one is in or a reserve for.
                  game({ id: 9, lineup: [{ ...seb, state: "reserve" }] }),
                  game({ id: 10, lineup: [{ ...anna, state: "in" }] }),
                  game({ id: 11, lineup: [{ ...seb, state: "out" }] }),
                ],
          }),
      },
      calls,
    );
    const a = renderWithQuery(<Upcoming />);
    expect(
      await screen.findByRole("heading", { name: "Deine nächsten Spiele" }),
    ).toBeInTheDocument();
    const list = await screen.findAllByRole("link");
    expect(list).toHaveLength(3);
    expect(list[0]).toHaveTextContent("Do 29.10., 18:30–20:00 · Padel Villach");
    expect(list[0]).toHaveTextContent("1 von 4 dabei · Padel Kärnten");
    expect(list[1]).toHaveTextContent("Gebucht · Padel Kärnten");
    expect(list[2]).toHaveTextContent("0 von 4 dabei · du bist Ersatz · Padel Kärnten");
    expect(list[0]).toHaveAttribute("href", "/games/7");
    a.unmount();

    renderWithQuery(<Upcoming group={1} />);
    expect(await screen.findByText("Noch kein Spiel geplant.")).toBeInTheDocument();
    expect(
      calls
        .filter((c) => c.url.pathname === "/api/v1/games")
        .at(-1)!
        .url.searchParams.get("groupId"),
    ).toBe("1");
  });

  it("says when there is nothing, and when it does not load", async () => {
    let up = false;
    serve({
      "GET /api/v1/me": () => answer(200, { ...seb, canInvite: false }),
      "GET /api/v1/games": () => (up ? answer(200, { items: [] }) : problem(500, "internal")),
    });
    renderWithQuery(<Upcoming />);
    expect(await screen.findByText("Die Spiele konnten nicht geladen werden.")).toBeInTheDocument();
    up = true;
    await userEvent.click(screen.getByRole("button", { name: "Nochmal versuchen" }));
    expect(await screen.findByText("Noch kein Spiel, bei dem du dabei bist.")).toBeInTheDocument();
    expect(within(document.body).queryByRole("link")).toBeNull();
  });
});
