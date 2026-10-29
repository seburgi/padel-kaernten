import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { answer, serve } from "../test/fetch";
import { renderWithQuery } from "../test/render";
import { FirstSteps } from "./FirstSteps";

const window = { from: "2026-10-29", to: "2026-11-11", templates: [], venues: [] };
const day = (spans: { from: number; to: number }[]) => ({
  day: "2026-10-30",
  spans,
  declined: false,
});
const group = (how: string) => ({
  id: 1,
  name: "Dienstagsrunde",
  kind: "private",
  area: "alle",
  how,
  members: 4,
  requested: false,
});

function setUp(name: string, days: unknown[], groups: unknown[]) {
  return serve({
    "GET /api/v1/me": () => answer(200, { email: "lisa@example.at", name, canInvite: false }),
    "GET /api/v1/availability": () => answer(200, { ...window, days }),
    "GET /api/v1/groups": () => answer(200, { items: groups }),
  });
}

describe("FirstSteps", () => {
  it("leads to the times first", async () => {
    setUp("", [day([])], []);
    renderWithQuery(<FirstSteps />);
    expect(await screen.findByRole("heading", { name: "Dein erstes Spiel" })).toBeInTheDocument();
    expect(screen.getByText("0 von 3")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Name");
    expect(screen.getByRole("link", { name: "Zeiten eintragen" })).toHaveAttribute(
      "href",
      "/availability",
    );
  });

  it("then to a group, unless an invitation waits", async () => {
    setUp("Lisa", [day([{ from: 1080, to: 1260 }])], []);
    const a = renderWithQuery(<FirstSteps />);
    expect(await screen.findByText("2 von 3")).toBeInTheDocument();
    expect(screen.getByText("Die anderen sehen dich als „Lisa“.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gruppe finden" })).toHaveAttribute("href", "/groups");
    a.unmount();

    setUp("Lisa", [day([{ from: 1080, to: 1260 }])], [group("invited")]);
    renderWithQuery(<FirstSteps />);
    expect(await screen.findByText("2 von 3")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("goes once every step is done", async () => {
    const calls = setUp("Lisa", [day([{ from: 1080, to: 1260 }])], [group("member")]);
    const { container } = renderWithQuery(<FirstSteps />);
    await waitFor(() => expect(calls.length).toBe(3));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
