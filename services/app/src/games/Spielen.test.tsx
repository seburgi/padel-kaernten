import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import type { Fit, Game as G } from "../api/client";
import { answer, problem, serve, type Sent } from "../test/fetch";
import { renderWithQuery } from "../test/render";
import { AskGroup } from "./AskGroup";
import { BestFits } from "./BestFits";
import { Waiting } from "./Waiting";

const p = (email: string, name = "") => ({ email, name });
const seb = p("seb@example.at", "Seb");
const anna = p("anna@example.at", "Anna");
const markus = p("markus@example.at", "Markus");
const lisa = p("lisa@example.at", "Lisa");
const me = () => answer(200, { ...seb, canInvite: false });

const game = (over: Partial<G> = {}): G => ({
  id: 7,
  groupId: 1,
  groupName: "Dienstagsrunde",
  venueId: "villach",
  venueName: "Padel Villach",
  court: "Court 1",
  day: "2026-10-29",
  start: 1110,
  minutes: 90,
  players: 4,
  perHead: { amount: 1500, currency: "EUR" },
  state: "proposed",
  proposedBy: anna,
  lineup: [{ ...anna, state: "in" }],
  ...over,
});

const fit = (over: Partial<Fit> = {}): Fit => ({
  day: "2026-11-03",
  start: 1140,
  minutes: 90,
  venueId: "villach",
  venueName: "Padel Villach",
  court: "Court 1",
  perHead: { amount: 1500, currency: "EUR" },
  can: [seb, anna, markus, lisa],
  ask: [],
  ...over,
});

const fits = (list: Fit[]) =>
  answer(200, { takenAt: new Date().toISOString(), need: 4, fits: list, nearly: [] });

const summary = (id: number, name: string, how = "member") => ({
  id,
  name,
  kind: "private",
  area: "alle",
  how,
  members: 4,
  requested: false,
});

function at(element: React.ReactNode) {
  return renderWithQuery(
    <Routes>
      <Route path="/play" element={element} />
      <Route path="/games/:id" element={<p>Spiel</p>} />
    </Routes>,
    { at: "/play" },
  );
}

describe("Waiting", () => {
  it("shows nothing when nothing waits", async () => {
    const calls = serve({
      "GET /api/v1/me": me,
      "GET /api/v1/games": () =>
        answer(200, {
          items: [
            game({ lineup: [{ ...seb, state: "in" }] }),
            game({ id: 8, lineup: [{ ...seb, state: "out" }] }),
            game({ id: 9, state: "booked" }),
          ],
        }),
    });
    const { container } = at(<Waiting />);
    await waitFor(() => expect(calls.length).toBe(2));
    expect(container).toBeEmptyDOMElement();
  });

  it("asks for an answer on the card, with the invitations beside", async () => {
    let answered = false;
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/me": me,
        "GET /api/v1/games": () =>
          answer(200, {
            items: answered
              ? [
                  game({
                    lineup: [
                      { ...anna, state: "in" },
                      { ...seb, state: "in" },
                    ],
                  }),
                ]
              : [
                  game(),
                  game({
                    id: 8,
                    lineup: [anna, markus, lisa, p("eva@x.at")].map((x) => ({ ...x, state: "in" })),
                  }),
                ],
          }),
        "PUT /api/v1/games/7/players/me": () => {
          answered = true;
          return answer(
            200,
            game({
              lineup: [
                { ...anna, state: "in" },
                { ...seb, state: "in" },
              ],
            }),
          );
        },
        "PUT /api/v1/games/8/players/me": () => problem(409, "game-closed"),
      },
      calls,
    );
    at(<Waiting invites={<p>Einladung in die Mittwochsliga</p>} invited={1} />);
    await screen.findByText("noch 3 gesucht");
    const head = await screen.findByRole("heading", { name: /Wartet auf dich/ });
    expect(head).toHaveTextContent("3");
    expect(screen.getByText("Einladung in die Mittwochsliga")).toBeInTheDocument();
    const [first, full] = screen.getAllByRole("listitem") as [HTMLElement, HTMLElement];
    expect(first).toHaveTextContent("Do 29.10., 18:30–20:00");
    expect(first).toHaveTextContent("Padel Villach · Court 1 · € 15 pro Kopf");
    expect(first).toHaveTextContent("noch 3 gesucht");
    expect(within(first).getByRole("img", { name: "1 von 4 dabei" })).toHaveTextContent("AN???");
    expect(within(first).getAllByRole("link")[0]).toHaveAttribute("href", "/games/7");
    expect(full).toHaveTextContent("voll");

    await userEvent.click(within(full).getByRole("button", { name: "Kann nicht" }));
    expect(await within(full).findByRole("alert")).toHaveTextContent(
      "Das Spiel ist abgesagt oder schon vorbei.",
    );

    await userEvent.click(within(first).getByRole("button", { name: "Bin dabei" }));
    await waitFor(() => expect(screen.queryAllByRole("listitem")).toHaveLength(0));
    expect(calls.find((c) => c.url.pathname === "/api/v1/games/7/players/me")!.body).toEqual({
      answer: "in",
    });
    // The invitation still waits.
    expect(screen.getByRole("heading", { name: /Wartet auf dich/ })).toHaveTextContent("1");
  });
});

describe("BestFits", () => {
  it("shows nothing outside any group", async () => {
    const calls = serve({
      "GET /api/v1/groups": () => answer(200, { items: [summary(1, "Offen", "open")] }),
      "GET /api/v1/games": () => answer(200, { items: [] }),
    });
    const { container } = at(<BestFits />);
    await waitFor(() => expect(calls.length).toBe(2));
    expect(container).toBeEmptyDOMElement();
  });

  it("takes the soonest from every group, without the proposed, and proposes", async () => {
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/groups": () =>
          answer(200, { items: [summary(1, "Dienstagsrunde"), summary(2, "Mittwochsliga")] }),
        "GET /api/v1/groups/1/fits": () =>
          fits([fit({ day: "2026-11-05" }), fit({ day: "2026-10-29", start: 1110 })]),
        "GET /api/v1/groups/2/fits": () =>
          fits([
            fit({
              day: "2026-11-01",
              venueId: "annenheim",
              venueName: "Padelbase Annenheim",
              perHead: undefined,
            }),
            fit({ day: "2026-11-06" }),
          ]),
        "GET /api/v1/games": () => answer(200, { items: [game()] }),
        "POST /api/v1/groups/2/games": () => answer(201, game({ id: 12, groupId: 2 })),
      },
      calls,
    );
    const { router } = at(<BestFits />);
    expect(await screen.findByRole("heading", { name: "Passt für vier" })).toBeInTheDocument();
    // Do 29.10. 18:30 is already game 7, so it is left out.
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    const items = screen.getAllByRole("listitem");
    expect(items.map((i) => i.querySelector(".font-semibold")!.textContent)).toEqual([
      "So 1.11., 19:00–20:30",
      "Do 5.11., 19:00–20:30",
      "Fr 6.11., 19:00–20:30",
    ]);
    expect(items[0]).toHaveTextContent("Padelbase Annenheim · Mittwochsliga");
    expect(items[1]).toHaveTextContent("Padel Villach · € 15 pro Kopf · Dienstagsrunde");
    expect(items[1]).toHaveTextContent("4 können: Seb, Anna, Markus, Lisa");
    expect(screen.queryByRole("link", { name: "Alle Zeiten" })).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "So 1.11. 19:00 in Padelbase Annenheim vorschlagen" }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/games/12"));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      venueId: "annenheim",
      court: "Court 1",
      day: "2026-11-01",
      start: 1140,
      minutes: 90,
    });
  });

  it("says when nothing fits, and when a court is gone", async () => {
    let none = false;
    serve({
      "GET /api/v1/groups": () => answer(200, { items: [summary(1, "Dienstagsrunde")] }),
      "GET /api/v1/groups/1/fits": () => fits(none ? [] : [fit()]),
      "GET /api/v1/games": () => answer(200, { items: [] }),
      "POST /api/v1/groups/1/games": () => {
        none = true;
        return problem(409, "court-gone");
      },
    });
    at(<BestFits />);
    expect(screen.queryByRole("button", { name: /Alle Zeiten/ })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: /vorschlagen/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Der Platz ist inzwischen weg.");
    expect(await screen.findByText(/Gerade passt nichts für vier/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wann kann ich?" })).toHaveAttribute(
      "href",
      "/availability",
    );
  });

  it("opens every fitting time from all groups in a sheet", async () => {
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/groups": () =>
          answer(200, { items: [summary(1, "Dienstagsrunde"), summary(2, "Mittwochsliga")] }),
        "GET /api/v1/groups/1/fits": () =>
          fits([fit({ day: "2026-11-05" }), fit({ day: "2026-11-05", start: 1230 })]),
        "GET /api/v1/groups/2/fits": () =>
          fits([fit({ day: "2026-11-01" }), fit({ day: "2026-11-07" })]),
        "GET /api/v1/games": () => answer(200, { items: [] }),
        "POST /api/v1/groups/1/games": () => answer(201, game({ id: 13, groupId: 1 })),
      },
      calls,
    );
    const { router } = at(<BestFits />);
    await userEvent.click(await screen.findByRole("button", { name: "Alle Zeiten (4)" }));
    const sheet = screen.getByRole("dialog", { name: "Alle passenden Zeiten" });
    expect(
      within(sheet)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(["So 1.11.", "Do 5.11.", "Sa 7.11."]);
    expect(within(sheet).getAllByRole("listitem")).toHaveLength(4);
    expect(within(sheet).getByRole("link", { name: "Mittwochsliga" })).toHaveAttribute(
      "href",
      "/groups/2/fits",
    );
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Do 5.11. 20:30 in Padel Villach vorschlagen" }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/games/13"));
  });

  it("closes the sheet", async () => {
    serve({
      "GET /api/v1/groups": () => answer(200, { items: [summary(1, "Dienstagsrunde")] }),
      "GET /api/v1/groups/1/fits": () =>
        fits(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"].map((day) => fit({ day }))),
      "GET /api/v1/games": () => answer(200, { items: [] }),
    });
    at(<BestFits />);
    await userEvent.click(await screen.findByRole("button", { name: "Alle Zeiten (4)" }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getAllByRole("listitem")[0]).not.toHaveTextContent("Dienstagsrunde");
    await userEvent.click(within(sheet).getByRole("button", { name: "Schließen" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps to one group on its page", async () => {
    serve({
      "GET /api/v1/groups": () =>
        answer(200, { items: [summary(1, "Dienstagsrunde"), summary(2, "Mittwochsliga")] }),
      "GET /api/v1/groups/2/fits": () => fits([fit()]),
      "GET /api/v1/games": () => answer(200, { items: [] }),
    });
    at(<BestFits group={2} />);
    expect(await screen.findByRole("link", { name: "Alle Zeiten" })).toHaveAttribute(
      "href",
      "/groups/2/fits",
    );
    expect(await screen.findAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).not.toHaveTextContent("Mittwochsliga");
  });

  it("says when the times do not load", async () => {
    serve({
      "GET /api/v1/groups": () => answer(200, { items: [summary(1, "Dienstagsrunde")] }),
      "GET /api/v1/groups/1/fits": () => problem(500, "internal"),
      "GET /api/v1/games": () => answer(200, { items: [] }),
    });
    at(<BestFits />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die passenden Zeiten konnten nicht geladen werden.",
    );
  });
});

describe("AskGroup", () => {
  const slot = {
    venueId: "villach",
    venueName: "Padel Villach",
    court: "Court 1",
    day: "2026-11-03",
    start: 1140,
    minutes: 90,
    href: "https://book.example/3",
  };

  it("says who of each group can, and proposes", async () => {
    const calls: Sent[] = [];
    let closed = false;
    serve(
      {
        "GET /api/v1/groups": () =>
          answer(200, {
            items: [
              summary(1, "Dienstagsrunde"),
              summary(2, "Mittwochsliga"),
              summary(3, "Fremd", "listed"),
              summary(4, "Leer"),
            ],
          }),
        "GET /api/v1/groups/1/fits": () => fits([fit()]),
        "GET /api/v1/groups/2/fits": () =>
          answer(200, {
            takenAt: new Date().toISOString(),
            need: 4,
            fits: [],
            nearly: [fit({ can: [seb, anna, markus], ask: [lisa] })],
          }),
        "GET /api/v1/groups/4/fits": () => fits([]),
        "POST /api/v1/groups/2/games": () => answer(201, game({ id: 13, groupId: 2 })),
      },
      calls,
    );
    const { router } = at(<AskGroup slot={slot} onClose={() => (closed = true)} />);
    const sheet = await screen.findByRole("dialog", { name: "Gruppe fragen" });
    expect(sheet).toHaveTextContent("Di 3.11., 19:00–20:30 · Padel Villach");
    expect(await within(sheet).findByText("4 können: Seb, Anna, Markus, Lisa")).toBeInTheDocument();
    expect(
      await within(sheet).findByText("Seb, Anna, Markus können. Frag Lisa."),
    ).toBeInTheDocument();
    expect(await within(sheet).findByText(/Noch nicht vier/)).toBeInTheDocument();
    expect(within(sheet).queryByText("Fremd")).toBeNull();
    expect(within(sheet).getByRole("link", { name: "Selbst buchen ↗" })).toHaveAttribute(
      "href",
      "https://book.example/3",
    );
    await userEvent.click(within(sheet).getByRole("button", { name: "Schließen" }));
    expect(closed).toBe(true);
    await userEvent.click(
      within(sheet).getByRole("button", { name: "In Mittwochsliga vorschlagen" }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/games/13"));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      venueId: "villach",
      court: "Court 1",
      day: "2026-11-03",
      start: 1140,
      minutes: 90,
    });
  });

  it("says when the court is gone", async () => {
    serve({
      "GET /api/v1/groups": () => answer(200, { items: [summary(1, "Dienstagsrunde")] }),
      "GET /api/v1/groups/1/fits": () => problem(500, "internal"),
      "POST /api/v1/groups/1/games": () => problem(409, "court-gone"),
    });
    at(<AskGroup slot={slot} onClose={() => {}} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "In Dienstagsrunde vorschlagen" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Der Platz ist inzwischen weg.");
  });
});
