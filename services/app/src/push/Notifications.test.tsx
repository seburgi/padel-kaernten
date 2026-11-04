import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { answer, serve, type Sent } from "../test/fetch";
import { renderWithQuery } from "../test/render";
import { Notifications } from "./Notifications";

const kinds = (off: string[] = []) => ({
  items: ["game", "before", "stale", "fits", "missing", "remind"].map((kind) => ({
    kind,
    on: !off.includes(kind),
    daily: ["fits", "missing", "remind"].includes(kind),
  })),
});

describe("Mitteilungen", () => {
  it("lists every kind and turns one off", async () => {
    vi.stubGlobal("Notification", undefined);
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/push": () => answer(200, {}),
        "GET /api/v1/push/kinds": () => answer(200, kinds(["fits"])),
        "PUT /api/v1/push/kinds/remind": () => answer(200, kinds(["fits", "remind"])),
      },
      calls,
    );
    renderWithQuery(<Notifications />);
    expect(await screen.findByRole("switch", { name: /Spiele deiner Gruppen/ })).toBeChecked();
    expect(screen.getByRole("switch", { name: /Es passt für vier/ })).not.toBeChecked();
    expect(screen.getAllByRole("switch")).toHaveLength(6);
    expect(screen.getByText(/höchstens eine Mitteilung am Tag/)).toBeVisible();

    await userEvent.click(screen.getByRole("switch", { name: /Wann kannst du\?/ }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /Wann kannst du\?/ })).not.toBeChecked(),
    );
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body).toEqual({ on: false });
    expect(put?.headers.get("Idempotency-Key")).toBeTruthy();
  });

  it("goes back when the change fails", async () => {
    vi.stubGlobal("Notification", undefined);
    serve({
      "GET /api/v1/push": () => answer(200, {}),
      "GET /api/v1/push/kinds": () => answer(200, kinds()),
      "PUT /api/v1/push/kinds/game": () => answer(500, { status: 500 }),
    });
    renderWithQuery(<Notifications />);
    await userEvent.click(await screen.findByRole("switch", { name: /Spiele deiner Gruppen/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /Spiele deiner Gruppen/ })).toBeChecked(),
    );
  });
});
