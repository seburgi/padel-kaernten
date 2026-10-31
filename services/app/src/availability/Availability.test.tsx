import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Availability as Mine, Span } from "../api/client";
import { answer, problem, serve, type Sent } from "../test/fetch";
import { renderWithQuery } from "../test/render";
import { Availability, MyVenues } from "./Availability";

// 2026-10-29 is a Thursday; Friday is weekday 5.
const start = (): Mine => ({
  from: "2026-10-29",
  to: "2026-11-11",
  days: [{ day: "2026-10-29", spans: [{ from: 1110, to: 1320 }], declined: false }],
  templates: [{ weekday: 5, spans: [{ from: 1080, to: 1260 }] }],
  venues: [],
});

const snapshot = {
  takenAt: "2026-10-29T08:00:00Z",
  days: ["2026-10-29"],
  venues: [
    { id: "villach", name: "Padel Villach", place: "Villach" },
    { id: "annenheim", name: "Annenheim", place: "Annenheim" },
  ],
};

function api(mine: Mine, calls: Sent[], opts: { dayErrors?: string[] } = {}) {
  const errors = [...(opts.dayErrors ?? [])];
  serve(
    {
      "GET /api/v1/availability": () => answer(200, mine),
      "GET /api/v1/slots": () => answer(200, snapshot),
      "PUT /api/v1/availability/templates": (sent) => {
        mine.templates = (sent.body as { templates: Mine["templates"] }).templates;
        return answer(200, { templates: mine.templates });
      },
      "PUT /api/v1/availability/venues": (sent) => {
        mine.venues = [...(sent.body as { venues: string[] }).venues].sort();
        return answer(200, { venues: mine.venues });
      },
    },
    calls,
  );
  // Days are matched by prefix: the router of the stand-in knows only exact paths.
  const exact = globalThis.fetch;
  const fake = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const m = new URL(req.url).pathname.match(/^\/api\/v1\/availability\/days\/(.+)$/);
    if (req.method === "PUT" && m) {
      const body = (await req.clone().json()) as { spans: Span[]; declined: boolean };
      calls.push({ method: "PUT", url: new URL(req.url), headers: req.headers, body });
      const error = errors.shift();
      if (error) return problem(400, error);
      const day = { day: m[1]!, spans: body.spans, declined: body.declined };
      mine.days = mine.days.filter((d) => d.day !== m[1]);
      if (body.spans.length || body.declined) mine.days.push(day);
      return answer(200, day);
    }
    return exact(input, init);
  };
  globalThis.fetch = fake as typeof fetch;
}

describe("Availability", () => {
  it("shows two weeks on a line and edits a day", async () => {
    const mine = start();
    const calls: Sent[] = [];
    api(mine, calls);
    renderWithQuery(<Availability />);
    const thu = await screen.findByRole("button", { name: "Do 29.10.: 18:30–22:00" });
    expect(screen.getAllByRole("button", { name: /noch offen/ })).toHaveLength(13);

    // Saturday: a quick choice, another span, then save.
    await userEvent.click(screen.getByRole("button", { name: "Sa 31.10.: noch offen" }));
    expect(screen.getByText(/Noch offen: zählt wie „kann nicht“/)).toBeInTheDocument();
    expect(screen.getByText("Noch offen: 13 von 14 Tagen")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Früh 7–9" }));
    await userEvent.click(screen.getByRole("button", { name: "+ Noch eine Zeit" }));
    await userEvent.selectOptions(screen.getByLabelText("Von", { selector: "#from-1" }), "1080");
    await userEvent.selectOptions(screen.getByLabelText("Bis", { selector: "#to-1" }), "1200");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByRole("button", { name: "Sa 31.10.: 7:00–9:00, 18:00–20:00" }),
    ).toBeInTheDocument();
    const put = calls.find((c) => c.url.pathname.endsWith("2026-10-31"))!;
    expect(put.body).toEqual({
      spans: [
        { from: 420, to: 540 },
        { from: 1080, to: 1200 },
      ],
      declined: false,
    });
    expect(put.headers.get("Idempotency-Key")).toBeTruthy();

    // Thursday: does not suit after all, and saving without times keeps it so.
    await userEvent.click(thu);
    await userEvent.click(screen.getByRole("button", { name: "Passt nicht" }));
    const no = await screen.findByRole("button", { name: "Do 29.10.: passt nicht" });
    expect(within(no).getByText("Passt nicht")).toBeInTheDocument();
    expect(calls.at(-1)!.body).toEqual({ spans: [], declined: true });
    await userEvent.click(no);
    expect(screen.getByText(/an diesem Tag spielst du nicht/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Passt nicht" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await screen.findByRole("button", { name: "Do 29.10.: passt nicht" });
    expect(calls.at(-1)!.body).toEqual({ spans: [], declined: true });
    // And open again.
    await userEvent.click(screen.getByRole("button", { name: "Do 29.10.: passt nicht" }));
    await userEvent.click(screen.getByRole("button", { name: "Wieder offen" }));
    expect(
      await screen.findByRole("button", { name: "Do 29.10.: noch offen" }),
    ).toBeInTheDocument();
    expect(calls.at(-1)!.body).toEqual({ spans: [], declined: false });

    // Cancel leaves a day as it was; a span can go again.
    await userEvent.click(screen.getByRole("button", { name: "So 1.11.: noch offen" }));
    await userEvent.click(screen.getByRole("button", { name: "+ Noch eine Zeit" }));
    await userEvent.click(screen.getByRole("button", { name: "+ Noch eine Zeit" }));
    await userEvent.click(screen.getByRole("button", { name: "18:00–19:00 weg" }));
    await userEvent.selectOptions(screen.getByLabelText("Von", { selector: "#from-0" }), "1380");
    expect(screen.getByLabelText("Bis", { selector: "#to-0" })).toHaveValue("1440");
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.getByRole("button", { name: "So 1.11.: noch offen" })).toBeInTheDocument();
    // On a phone a tap on the dimmed page behind closes it too, as does Escape.
    await userEvent.click(screen.getByRole("button", { name: "So 1.11.: noch offen" }));
    await userEvent.click(document.querySelector<HTMLElement>("[data-backdrop]")!);
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "So 1.11.: noch offen" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses the usual times and remembers new ones", async () => {
    const mine = start();
    const calls: Sent[] = [];
    api(mine, calls);
    renderWithQuery(<Availability />);
    // Two Fridays are empty and usually 18–21.
    await userEvent.click(
      await screen.findByRole("button", { name: "2 leere Tage wie meistens füllen" }),
    );
    expect(
      await screen.findByRole("button", { name: "Fr 30.10.: 18:00–21:00" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fr 6.11.: 18:00–21:00" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /wie meistens füllen/ })).toBeNull();

    // On a Friday the usual time is offered once it differs.
    await userEvent.click(screen.getByRole("button", { name: "Fr 30.10.: 18:00–21:00" }));
    expect(screen.queryByRole("button", { name: /Wie meistens/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Ganzer Tag" }));
    await userEvent.click(screen.getByRole("button", { name: "Wie meistens: 18:00–21:00" }));
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    // A Monday becomes the usual for Mondays.
    await userEvent.click(screen.getByRole("button", { name: "Mo 2.11.: noch offen" }));
    await userEvent.click(screen.getByRole("button", { name: "Abend ab 18" }));
    await userEvent.click(screen.getByLabelText("So ist es meistens am Montag"));
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await screen.findByRole("button", { name: "Mo 2.11.: 18:00–24:00" });
    expect(mine.templates).toEqual([
      { weekday: 5, spans: [{ from: 1080, to: 1260 }] },
      { weekday: 1, spans: [{ from: 1080, to: 1440 }] },
    ]);
    // The other empty Monday can now be filled.
    expect(
      screen.getByRole("button", { name: "1 leere Tag wie meistens füllen" }),
    ).toBeInTheDocument();

    // A Friday that does not suit, remembered, forgets Fridays.
    await userEvent.click(screen.getByRole("button", { name: "Fr 6.11.: 18:00–21:00" }));
    await userEvent.click(screen.getByLabelText("So ist es meistens am Freitag"));
    await userEvent.click(screen.getByRole("button", { name: "Passt nicht" }));
    await screen.findByRole("button", { name: "Fr 6.11.: passt nicht" });
    expect(mine.templates).toEqual([{ weekday: 1, spans: [{ from: 1080, to: 1440 }] }]);
  });

  it("leaves a day that does not suit as it is when filling", async () => {
    const mine = start();
    mine.days.push({ day: "2026-10-30", spans: [], declined: true });
    const calls: Sent[] = [];
    api(mine, calls);
    renderWithQuery(<Availability />);
    await userEvent.click(
      await screen.findByRole("button", { name: "1 leere Tag wie meistens füllen" }),
    );
    expect(
      await screen.findByRole("button", { name: "Fr 6.11.: 18:00–21:00" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fr 30.10.: passt nicht" })).toBeInTheDocument();
    expect(screen.getByText("Noch offen: 11 von 14 Tagen")).toBeInTheDocument();
  });

  it("says when every day is entered", async () => {
    const mine = start();
    mine.to = "2026-10-29";
    api(mine, []);
    renderWithQuery(<Availability />);
    expect(await screen.findByText("Alle Tage sind eingetragen.")).toBeInTheDocument();
  });

  it("says what went wrong", async () => {
    const mine = start();
    mine.days = [];
    const calls: Sent[] = [];
    api(mine, calls, { dayErrors: ["boom", "boom", "invalid-spans", "outside-window"] });
    renderWithQuery(<Availability />);
    await userEvent.click(
      await screen.findByRole("button", { name: "2 leere Tage wie meistens füllen" }),
    );
    expect(await screen.findByText(/Nicht alle Tage wurden gefüllt/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sa 31.10.: noch offen" }));
    await userEvent.click(screen.getByRole("button", { name: "Mittag 12–14" }));
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText("Das hat nicht geklappt. Versuch es nochmal."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(/halbe Stunden von 6 bis 24/)).toBeInTheDocument();
    // The retries of the same day keep its key.
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(/nächsten 13 Tage/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await screen.findByRole("button", { name: "Sa 31.10.: 12:00–14:00" });
    const sat = calls.filter((c) => c.url.pathname.endsWith("2026-10-31"));
    expect(sat).toHaveLength(4);
    expect(new Set(sat.map((c) => c.headers.get("Idempotency-Key"))).size).toBe(1);
  });

  it("names the chosen venues under the days, with a link to Mehr", async () => {
    const mine = start();
    api(mine, []);
    const { unmount } = renderWithQuery(<Availability />);
    expect(await screen.findByText("Deine Plätze:")).toBeInTheDocument();
    expect(screen.getByText(/alle ·/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ändern" })).toHaveAttribute("href", "/more");
    expect(screen.queryByRole("button", { name: "Annenheim" })).toBeNull();
    unmount();

    mine.venues = ["annenheim", "villach"];
    renderWithQuery(<Availability />);
    expect(await screen.findByText(/Padel Villach, Annenheim ·/)).toBeInTheDocument();
  });

  it("chooses venues, and hides them without a snapshot", async () => {
    const mine = start();
    const calls: Sent[] = [];
    api(mine, calls);
    const { unmount } = renderWithQuery(<MyVenues />);
    expect(await screen.findByText(/Überall hin/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Padel Villach" }));
    expect(await screen.findByText("Nur zu diesen:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Padel Villach" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "Annenheim" }));
    await waitFor(() => expect(mine.venues).toEqual(["annenheim", "villach"]));
    await userEvent.click(screen.getByRole("button", { name: "Padel Villach" }));
    await waitFor(() => expect(mine.venues).toEqual(["annenheim"]));
    unmount();

    serve({
      "GET /api/v1/availability": () => answer(200, start()),
      "GET /api/v1/slots": () => problem(404, "no-snapshot"),
    });
    renderWithQuery(<Availability />);
    await screen.findByRole("button", { name: "Do 29.10.: 18:30–22:00" });
    expect(screen.queryByText("Deine Plätze:")).toBeNull();
  });

  it("chooses venues on Mehr too, as Deine Plätze", async () => {
    const mine = start();
    mine.venues = ["villach"];
    api(mine, []);
    renderWithQuery(<MyVenues />);
    expect(await screen.findByRole("heading", { name: "Deine Plätze" })).toBeInTheDocument();
    expect(screen.getByText("Nur zu diesen:")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Annenheim" }));
    await waitFor(() => expect(mine.venues).toEqual(["annenheim", "villach"]));
    expect(screen.queryByText("Wann kannst du?")).toBeNull();
  });

  it("says when a venue is gone, and when nothing loads", async () => {
    serve({
      "GET /api/v1/availability": () => answer(200, start()),
      "GET /api/v1/slots": () => answer(200, snapshot),
      "PUT /api/v1/availability/venues": () => problem(400, "unknown-venue"),
    });
    const { unmount } = renderWithQuery(<MyVenues />);
    await userEvent.click(await screen.findByRole("button", { name: "Annenheim" }));
    expect(await screen.findByText("Diese Anlage gibt es nicht mehr.")).toBeInTheDocument();
    unmount();

    let up = false;
    serve({
      "GET /api/v1/availability": () => (up ? answer(200, start()) : problem(500, "internal")),
      "GET /api/v1/slots": () => problem(500, "internal"),
    });
    renderWithQuery(<Availability />);
    expect(
      await screen.findByText("Deine Zeiten konnten nicht geladen werden."),
    ).toBeInTheDocument();
    up = true;
    await userEvent.click(screen.getByRole("button", { name: "Nochmal versuchen" }));
    const row = await screen.findByRole("button", { name: "Do 29.10.: 18:30–22:00" });
    expect(within(row).getByText("18:30–22:00")).toBeInTheDocument();
    expect(screen.queryByText("Deine Plätze:")).toBeNull();
  });
});
