import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { answer, problem, serve, type Sent } from "../test/fetch";
import { renderWithQuery } from "../test/render";
import { Invitations } from "./Invitations";

describe("Invitations", () => {
  it("invites, lists and withdraws", async () => {
    let items = [{ email: "anna@example.at", invitedAt: "2026-10-27T10:00:00Z" }];
    let platformDown = true;
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/invitations": () => answer(200, { items }),
        "POST /api/v1/invitations": (sent) => {
          if (platformDown) return problem(502, "platform-failed");
          const email = (sent.body as { email: string }).email;
          items = [...items, { email, invitedAt: "2026-10-27T11:00:00Z" }];
          return answer(201, items[items.length - 1]);
        },
        "DELETE /api/v1/invitations/anna@example.at": () => {
          items = items.filter((i) => i.email !== "anna@example.at");
          return answer(204);
        },
      },
      calls,
    );
    renderWithQuery(<Invitations />);
    expect(await screen.findByText("anna@example.at")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("E-Mail-Adresse"), "bert@example.at");
    await userEvent.click(screen.getByRole("button", { name: "Einladen" }));
    expect(await screen.findByText(/Die Anmeldung hat nicht geantwortet/)).toBeInTheDocument();
    platformDown = false;
    await userEvent.click(screen.getByRole("button", { name: "Einladen" }));
    expect(await screen.findByText(/bert@example.at ist eingeladen/)).toBeInTheDocument();
    const posts = calls.filter((c) => c.method === "POST");
    // The retry of the same invitation reuses its key.
    expect(posts).toHaveLength(2);
    expect(posts[0]!.headers.get("Idempotency-Key")).toBe(posts[1]!.headers.get("Idempotency-Key"));
    expect(await screen.findByText("bert@example.at")).toBeInTheDocument();

    const row = screen.getByText("anna@example.at").closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Zurücknehmen …" }));
    await userEvent.click(within(row).getByRole("button", { name: "Abbrechen" }));
    await userEvent.click(within(row).getByRole("button", { name: "Zurücknehmen …" }));
    await userEvent.click(within(row).getByRole("button", { name: "Zurücknehmen" }));
    await waitFor(() => expect(screen.queryByText("anna@example.at")).toBeNull());
  });

  it("says what is wrong with an address, and when nobody is invited", async () => {
    serve({
      "GET /api/v1/invitations": () => answer(200, { items: [] }),
      "POST /api/v1/invitations": () => problem(400, "invalid-email"),
    });
    renderWithQuery(<Invitations />);
    expect(await screen.findByText(/Noch niemand/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("E-Mail-Adresse"), "nope@x");
    await userEvent.click(screen.getByRole("button", { name: "Einladen" }));
    expect(await screen.findByText(/Das ist keine E-Mail-Adresse/)).toBeInTheDocument();
  });

  it("pages through every invitation, and says when the list fails", async () => {
    let fail = true;
    serve({
      "GET /api/v1/invitations": (sent) => {
        if (fail) return problem(500, "internal");
        return sent.url.searchParams.get("cursor")
          ? answer(200, { items: [{ email: "z@example.at", invitedAt: "2026-10-27T10:00:00Z" }] })
          : answer(200, {
              items: [{ email: "a@example.at", invitedAt: "2026-10-27T10:00:00Z" }],
              nextCursor: "eg",
            });
      },
      "DELETE /api/v1/invitations/a@example.at": () => problem(403, "not-owner"),
    });
    renderWithQuery(<Invitations />);
    expect(await screen.findByText(/konnten nicht geladen werden/)).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Nochmal versuchen" }));
    expect(await screen.findByText("z@example.at")).toBeInTheDocument();
    const row = screen.getByText("a@example.at").closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Zurücknehmen …" }));
    await userEvent.click(within(row).getByRole("button", { name: "Zurücknehmen" }));
    expect(await screen.findByText("Nur Seb kann einladen.")).toBeInTheDocument();
  });
});
