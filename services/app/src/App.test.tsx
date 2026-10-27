import { screen, waitFor } from "@testing-library/react";
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

describe("App", () => {
  it("shows Einladen to Seb and opens the invitations", async () => {
    serve({
      "GET /api/v1/me": () => answer(200, { email: "seb@example.at", canInvite: true }),
      "GET /api/v1/slots": () => answer(200, snapshot()),
      "GET /api/v1/invitations": () => answer(200, { items: [] }),
    });
    renderWithQuery(<App />);
    await userEvent.click(await screen.findByRole("link", { name: "Einladen" }));
    expect(await screen.findByRole("heading", { name: "Einladen" })).toBeInTheDocument();
    expect(location.pathname).toBe("/einladen");
    await userEvent.click(screen.getByRole("link", { name: "Padel Kärnten" }));
    expect(location.pathname).toBe("/");
  });

  it("never shows the invitations to anyone else", async () => {
    history.replaceState(null, "", "/einladen");
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/me": () => answer(200, { email: "anna@example.at", canInvite: false }),
        "GET /api/v1/slots": () => answer(200, snapshot()),
      },
      calls,
    );
    renderWithQuery(<App />);
    expect(await screen.findByText(/Nichts frei/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Einladen" })).toBeNull();
    expect(calls.some((c) => c.url.pathname === "/api/v1/invitations")).toBe(false);
    // Every call says which build sent it.
    expect(calls[0]!.headers.get("X-Client")).toMatch(/^web\//);
  });

  it("goes back with the browser", async () => {
    serve({
      "GET /api/v1/me": () => problem(500, "internal"),
      "GET /api/v1/slots": () => answer(200, snapshot()),
    });
    renderWithQuery(<App />);
    history.pushState(null, "", "/feedback");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(screen.queryByText(/Nichts frei/)).toBeNull());
  });
});
