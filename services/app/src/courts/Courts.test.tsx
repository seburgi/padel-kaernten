import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { answer, problem, serve, type Sent } from "../test/fetch";
import { renderWithQuery } from "../test/render";
import { Courts } from "./Courts";
import { viennaNow } from "./search";

const today = viennaNow().date;
function snapshot(minutesOld: number, over: object = {}) {
  return {
    takenAt: new Date(Date.now() - minutesOld * 60000).toISOString(),
    days: [today],
    venues: [
      {
        id: "a",
        name: "Arena",
        place: "Klagenfurt",
        address: "Südring 1",
        platform: "eversports",
        priceNote: "Abends teurer.",
        failed: false,
        notBookable: [],
        step: 30,
        links: { [today]: "https://book/a" },
        courts: [
          {
            name: "Court 1",
            area: "halle",
            free: [
              { day: today, from: 1380, to: 1440, pricePerHour: { amount: 4000, currency: "EUR" } },
            ],
          },
          { name: "Court 2", area: "freiluft", free: [{ day: today, from: 1380, to: 1440 }] },
        ],
      },
      {
        id: "b",
        name: "Base",
        place: "Annenheim",
        platform: "etennis",
        failed: false,
        notBookable: [],
        step: 30,
        links: {},
        courts: [{ name: "C", area: "freiluft", free: [] }],
      },
      {
        id: "c",
        name: "Campus",
        place: "Moosburg",
        platform: "padelmates",
        failed: false,
        notBookable: [today],
        step: 30,
        links: {},
        courts: [],
      },
      {
        id: "d",
        name: "Down",
        place: "X",
        platform: "wansport",
        failed: true,
        notBookable: [],
        step: 30,
        links: { [today]: "https://book/d" },
        courts: [],
      },
    ],
    ...over,
  };
}

describe("Courts", () => {
  it("shows a fresh snapshot without asking the sites", async () => {
    history.replaceState(null, "", "#ab=23:00&bis=24:00&dauer=60");
    const calls: Sent[] = [];
    serve({ "GET /api/v1/slots": () => answer(200, snapshot(1)) }, calls);
    renderWithQuery(<Courts />);
    expect(await screen.findByText("1 von 2 Anlagen haben was frei")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /23:00\s*40 €/ })).toHaveAttribute(
      "href",
      "https://book/a",
    );
    expect(screen.getByText("Startzeiten nur zur vollen Stunde.")).toBeInTheDocument();
    expect(screen.getByText("Abends teurer.")).toBeInTheDocument();
    expect(screen.getByText(/Ausgebucht:/).parentElement).toHaveTextContent("Base");
    expect(screen.getByText(/Noch nicht buchbar:/).parentElement).toHaveTextContent("Campus");
    expect(screen.getByRole("link", { name: "Direkt nachsehen" })).toHaveAttribute(
      "href",
      "https://book/d",
    );
    expect(screen.getByRole("link", { name: "Karte" })).toHaveAttribute(
      "href",
      expect.stringContaining("maps"),
    );
    expect(calls.map((c) => c.method)).toEqual(["GET"]);

    // Filters change the search and the address.
    await userEvent.click(screen.getByRole("button", { name: "Halle" }));
    expect(location.hash).toContain("plaetze=halle");
    expect(screen.queryByText("Court 2")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "2 h" }));
    expect(await screen.findByText("Nichts frei")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Nur 1 h spielen" }));
    expect(screen.getByText("1 von 1 Anlagen haben was frei")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Beginn ab"), "1200");
    await userEvent.selectOptions(screen.getByLabelText("Ende bis"), "1260");
    expect(screen.getByText("Nichts frei")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Fenster um je 1 h erweitern" }));
    expect(location.hash).toContain("ab=19:00&bis=22:00");
    act(() => {
      location.hash = "#ab=23:00&bis=24:00&dauer=60";
    });
    await waitFor(() =>
      expect(screen.getByText("1 von 2 Anlagen haben was frei")).toBeInTheDocument(),
    );
  });

  it("asks the sites by itself only when the schedule missed (an hour old)", async () => {
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/slots": () => answer(200, snapshot(61)),
        "POST /api/v1/slots/refresh": () => answer(200, snapshot(0, { venues: [] })),
      },
      calls,
    );
    renderWithQuery(<Courts />);
    await waitFor(() => expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]));
    expect(calls[1]!.headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText("Nichts frei")).toBeInTheDocument();

    // Coming back to the app with a fresh snapshot asks nothing, and
    // Aktualisieren waits for five minutes.
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(calls).toHaveLength(2);
    expect(screen.getByText(/aktuell, wieder abfragen ab \d\d:\d\d/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aktualisieren" })).toBeNull();
  });

  it("opens on a half-hour-old snapshot without asking, and Aktualisieren asks", async () => {
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/slots": () => answer(200, snapshot(30)),
        "POST /api/v1/slots/refresh": () => answer(200, snapshot(0, { venues: [] })),
      },
      calls,
    );
    renderWithQuery(<Courts />);
    await userEvent.click(await screen.findByRole("button", { name: "Aktualisieren" }));
    expect(await screen.findByText("Nichts frei")).toBeInTheDocument();
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(screen.getByText(/wieder abfragen ab/)).toBeInTheDocument();
  });

  it("asks the sites before the first snapshot, and says when they fail", async () => {
    let fail = true;
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/slots": () => problem(503, "no-snapshot"),
        "POST /api/v1/slots/refresh": () =>
          fail ? problem(502, "sites-failed") : answer(200, snapshot(0)),
      },
      calls,
    );
    renderWithQuery(<Courts />);
    expect(
      await screen.findByText(/Die Buchungsseiten antworten gerade nicht/),
    ).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Nochmal versuchen" }));
    expect(await screen.findByText(/Anlagen haben was frei|Nichts frei/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
  });

  it("keeps the old snapshot when a refresh fails, with Try again", async () => {
    serve({
      "GET /api/v1/slots": () => answer(200, snapshot(61)),
      "POST /api/v1/slots/refresh": () => problem(502, "sites-failed"),
    });
    renderWithQuery(<Courts />);
    expect(await screen.findByText(/Aktualisieren hat nicht geklappt/)).toBeInTheDocument();
    expect(screen.getByText(/Stand:/)).toBeInTheDocument();
  });

  it("says when the courts cannot be loaded", async () => {
    let fail = true;
    serve({
      "GET /api/v1/slots": () => (fail ? problem(500, "internal") : answer(200, snapshot(1))),
    });
    renderWithQuery(<Courts />);
    expect(await screen.findByText(/konnten nicht geladen werden/)).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Nochmal versuchen" }));
    expect(await screen.findByText(/Stand:/)).toBeInTheDocument();
  });
});
