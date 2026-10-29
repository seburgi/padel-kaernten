import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { answer, problem, serve, type Sent } from "./test/fetch";
import { renderWithQuery } from "./test/render";

const now = () => new Date().toISOString();
const snapshot = (takenAt = now()) => ({
  takenAt,
  days: [new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Vienna" })],
  venues: [],
});

const note = (slug: string, read: boolean) => ({
  slug,
  date: slug.slice(0, 10),
  area: "app",
  title: `Note ${slug}`,
  paragraphs: ["Was sich geändert hat."],
  read,
});

describe("App", () => {
  it("shows Einladen to Seb and opens the invites", async () => {
    serve({
      "GET /api/v1/me": () => answer(200, { email: "seb@example.at", canInvite: true }),
      "GET /api/v1/slots": () => answer(200, snapshot()),
      "GET /api/v1/invitations": () => answer(200, { items: [] }),
      "GET /api/v1/release-notes": () => answer(200, { items: [] }),
    });
    const { router } = renderWithQuery(<App />);
    await userEvent.click(await screen.findByRole("link", { name: "Einladen" }));
    expect(await screen.findByRole("heading", { name: "Einladen" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/invites");
    await userEvent.click(screen.getByRole("link", { name: "Padel Kärnten" }));
    expect(router.state.location.pathname).toBe("/");
  });

  it("goes to Spielen and back to Plätze", async () => {
    serve({
      "GET /api/v1/me": () =>
        answer(200, { email: "anna@example.at", name: "Anna", canInvite: false }),
      "GET /api/v1/slots": () => answer(200, snapshot()),
      "GET /api/v1/groups": () => answer(200, { items: [] }),
      "GET /api/v1/availability": () =>
        answer(200, { from: "2026-10-29", to: "2026-11-11", days: [], templates: [], venues: [] }),
      "GET /api/v1/release-notes": () => answer(200, { items: [] }),
    });
    const { router } = renderWithQuery(<App />);
    // The switch in the head on a wide screen, the tab bar on a phone; CSS
    // shows one of them, jsdom both.
    const [head, bar] = (await screen.findAllByRole("navigation", { name: "Bereiche" })) as [
      HTMLElement,
      HTMLElement,
    ];
    await userEvent.click(within(head).getByRole("link", { name: "Spielen" }));
    expect(await screen.findByRole("heading", { name: "Spielen" })).toBeInTheDocument();
    for (const nav of [head, bar])
      expect(within(nav).getByRole("link", { name: "Spielen" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    // On a phone Wann kann ich? is a tab of its own, after Plätze.
    expect(
      within(bar)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Plätze", "Wann kann ich?", "Spielen", "Mehr"]);
    await userEvent.click(within(bar).getByRole("link", { name: "Wann kann ich?" }));
    expect(await screen.findByRole("heading", { name: "Wann kannst du?" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/availability");
    expect(within(bar).getByRole("link", { name: "Wann kann ich?" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(bar).getByRole("link", { name: "Spielen" })).not.toHaveAttribute("aria-current");
    expect(within(head).getByRole("link", { name: "Spielen" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await userEvent.click(within(bar).getByRole("link", { name: "Plätze" }));
    expect(router.state.location.pathname).toBe("/");
    expect(within(head).getByRole("link", { name: "Plätze" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("puts Neu, Hilfe and Einladen behind Mehr, with a dot for what is unread", async () => {
    serve({
      "GET /api/v1/me": () =>
        answer(200, { email: "seb@example.at", name: "Seb", canInvite: true, welcomed: true }),
      "GET /api/v1/slots": () => answer(200, snapshot()),
      "GET /api/v1/invitations": () => answer(200, { items: [] }),
      "GET /api/v1/release-notes": () =>
        answer(200, {
          items: [
            {
              slug: "2026-10-28-leiste",
              date: "2026-10-28",
              area: "app",
              title: "Unten",
              paragraphs: ["Die Bereiche sind unten."],
              read: false,
            },
          ],
        }),
    });
    const { router } = renderWithQuery(<App />);
    const bar = (await screen.findAllByRole("navigation", { name: "Bereiche" }))[1]!;
    await userEvent.click(await within(bar).findByRole("link", { name: "Mehr, neu" }));
    expect(router.state.location.pathname).toBe("/more");
    const more = within(screen.getByRole("main"));
    expect(more.getByRole("link", { name: /Neu.*1 ungelesen/ })).toHaveAttribute(
      "href",
      "/whats-new",
    );
    expect(more.getByRole("link", { name: "Deine Rückmeldungen" })).toHaveAttribute(
      "href",
      "/feedback",
    );
    await userEvent.click(more.getByRole("link", { name: "Einladen" }));
    expect(router.state.location.pathname).toBe("/invites");
    expect(within(bar).getByRole("link", { name: /^Mehr/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens the Hilfe from the head", async () => {
    serve({
      "GET /api/v1/me": () =>
        answer(200, { email: "anna@example.at", name: "Anna", canInvite: false }),
      "GET /api/v1/slots": () => answer(200, snapshot()),
      "GET /api/v1/release-notes": () => answer(200, { items: [] }),
    });
    const { router } = renderWithQuery(<App />);
    const head = within(screen.getByRole("banner"));
    await userEvent.click(await head.findByRole("link", { name: "Hilfe" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Hilfe" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/help");
    expect(head.queryByRole("link", { name: "Hilfe" })).not.toBeInTheDocument();
  });

  it("takes the old address to the new one", async () => {
    serve({
      "GET /api/v1/me": () => answer(200, { email: "seb@example.at", canInvite: true }),
      "GET /api/v1/invitations": () => answer(200, { items: [] }),
      "GET /api/v1/release-notes": () => answer(200, { items: [] }),
    });
    const { router } = renderWithQuery(<App />, { at: "/einladen" });
    expect(await screen.findByRole("heading", { name: "Einladen" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/invites");
  });

  it("never shows the invites to anyone else", async () => {
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/me": () => answer(200, { email: "anna@example.at", canInvite: false }),
        "GET /api/v1/slots": () => answer(200, snapshot()),
        "GET /api/v1/release-notes": () => answer(200, { items: [] }),
      },
      calls,
    );
    renderWithQuery(<App />, { at: "/invites" });
    expect(await screen.findByText(/Nichts frei/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Einladen" })).toBeNull();
    expect(calls.some((c) => c.url.pathname === "/api/v1/invitations")).toBe(false);
    // Every call says which build sent it.
    expect(calls[0]!.headers.get("X-Client")).toMatch(/^web\//);
  });

  it("sends an unknown address to the courts", async () => {
    serve({
      "GET /api/v1/me": () => problem(500, "internal"),
      "GET /api/v1/slots": () => answer(200, snapshot()),
      "GET /api/v1/release-notes": () => problem(500, "internal"),
    });
    const { router } = renderWithQuery(<App />, { at: "/nowhere" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByText(/Nichts frei/)).toBeInTheDocument();
  });

  it("tells about what is new until it is read", async () => {
    const calls: Sent[] = [];
    let read = false;
    serve(
      {
        "GET /api/v1/me": () => answer(200, { email: "anna@example.at", canInvite: false }),
        "GET /api/v1/slots": () => answer(200, snapshot()),
        "GET /api/v1/release-notes": () =>
          answer(200, { items: [note("2026-10-28-new", read), note("2026-10-27-old", true)] }),
        "POST /api/v1/release-notes/read": () => {
          read = true;
          return answer(204);
        },
      },
      calls,
    );
    const { router } = renderWithQuery(<App />);
    expect(
      await screen.findByText(/Eine Neuigkeit seit deinem letzten Besuch/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Ansehen" }));
    expect(router.state.location.pathname).toBe("/whats-new");
    expect(await screen.findByRole("heading", { name: "Neu" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Note 2026-10-28-new" })).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({ slugs: ["2026-10-28-new"] }),
    );
    await userEvent.click(screen.getByRole("link", { name: "Padel Kärnten" }));
    expect(screen.queryByText(/seit deinem letzten Besuch/)).toBeNull();
  });
});
