import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { GroupSummary } from "../api/client";
import { answer, problem, serve, type Sent } from "../test/fetch";
import { renderWithQuery } from "../test/render";
import { Groups, NewGroup } from "./Groups";
import { Play } from "./Play";

const g = (over: Partial<GroupSummary>): GroupSummary => ({
  id: 1,
  name: "Padel Kärnten",
  kind: "private",
  area: "alle",
  how: "member",
  members: 4,
  requested: false,
  ...over,
});

describe("Play", () => {
  it("asks for a name, answers invitations and lists the groups", async () => {
    let me = { email: "anna@example.at", name: "", canInvite: false };
    let items = [
      g({ id: 1, role: "admin" }),
      g({ id: 2, name: "Donnerstagsrunde", how: "invited", members: 1 }),
      g({ id: 3, name: "Morgenrunde", how: "invited" }),
      g({ id: 4, name: "Offene Runde", how: "listed", kind: "on_request", requested: true }),
    ];
    let platformDown = true;
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/me": () => answer(200, me),
        "PUT /api/v1/me/name": (sent) => {
          me = { ...me, name: (sent.body as { name: string }).name };
          return answer(200, me);
        },
        "GET /api/v1/groups": () => answer(200, { items }),
        "POST /api/v1/groups/2/join": () => {
          if (platformDown) return problem(502, "platform-failed");
          items = items.map((i) => (i.id === 2 ? { ...i, how: "member", members: 2 } : i));
          return answer(200, { state: "member" });
        },
        "DELETE /api/v1/groups/3/invitations/anna@example.at": () => {
          items = items.filter((i) => i.id !== 3);
          return answer(204);
        },
      },
      calls,
    );
    renderWithQuery(<Play />);
    await userEvent.type(
      await screen.findByLabelText("Wie sollen dich die anderen sehen?"),
      " Anna ",
    );
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(screen.queryByLabelText(/Wie sollen dich/)).toBeNull());
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ name: "Anna" });

    expect(screen.getByRole("link", { name: /Padel Kärnten/ })).toHaveTextContent(
      "4 Mitglieder · Privat · du bist Admin",
    );
    expect(screen.getByText("Angefragt: Offene Runde")).toBeInTheDocument();
    const thursday = screen.getByText("Donnerstagsrunde").closest("li")!;
    expect(thursday).toHaveTextContent("1 Mitglied");
    await userEvent.click(within(thursday).getByRole("button", { name: "Annehmen" }));
    expect(await screen.findByText(/Die Anmeldung hat nicht geantwortet/)).toBeInTheDocument();
    platformDown = false;
    await userEvent.click(within(thursday).getByRole("button", { name: "Annehmen" }));
    expect(await screen.findByRole("link", { name: /Donnerstagsrunde/ })).toBeInTheDocument();

    const morning = screen.getByText("Morgenrunde").closest("li")!;
    await userEvent.click(within(morning).getByRole("button", { name: "Ablehnen" }));
    await waitFor(() => expect(screen.queryByText("Morgenrunde")).toBeNull());
    expect(screen.queryByText("Einladungen")).toBeNull();
  });

  it("says when there are no groups, and when they do not load", async () => {
    let up = false;
    serve({
      "GET /api/v1/me": () => answer(200, { email: "a@example.at", name: "A", canInvite: false }),
      "GET /api/v1/groups": () => (up ? answer(200, { items: [] }) : problem(500, "internal")),
      "PUT /api/v1/me/name": () => problem(400, "invalid-name"),
    });
    renderWithQuery(<Play />);
    expect(
      await screen.findByText("Deine Gruppen konnten nicht geladen werden."),
    ).toBeInTheDocument();
    up = true;
    await userEvent.click(screen.getByRole("button", { name: "Nochmal versuchen" }));
    expect(await screen.findByText(/noch in keiner Gruppe/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Wie sollen dich/)).toBeNull();
  });

  it("says when a name is refused", async () => {
    serve({
      "GET /api/v1/me": () => answer(200, { email: "a@example.at", name: "", canInvite: false }),
      "GET /api/v1/groups": () => answer(200, { items: [] }),
      "PUT /api/v1/me/name": () => problem(400, "invalid-name"),
    });
    renderWithQuery(<Play />);
    await userEvent.type(await screen.findByLabelText(/Wie sollen dich/), "x");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Ein Name hat 1 bis 40 Zeichen.")).toBeInTheDocument();
  });
});

describe("Groups", () => {
  it("joins an open group and asks into one on request", async () => {
    let items = [
      g({ id: 5, name: "Offen", kind: "open", how: "listed", members: 1 }),
      g({ id: 6, name: "Auf Anfrage", kind: "on_request", how: "listed" }),
      g({ id: 7, name: "Schon gefragt", kind: "on_request", how: "listed", requested: true }),
      g({ id: 1 }),
    ];
    serve({
      "GET /api/v1/groups": () => answer(200, { items }),
      "POST /api/v1/groups/6/join": () => {
        items = items.map((i) => (i.id === 6 ? { ...i, requested: true } : i));
        return answer(200, { state: "requested" });
      },
      "POST /api/v1/groups/5/join": () => answer(200, { state: "member" }),
    });
    const { router } = renderWithQuery(<Groups />, { at: "/groups" });
    const ask = within(
      (await screen.findByText("Auf Anfrage", { selector: "div" })).closest("li")!,
    );
    expect(screen.queryByText("Padel Kärnten")).toBeNull();
    expect(
      within(screen.getByText("Schon gefragt").closest("li")!).getByText("Angefragt"),
    ).toBeInTheDocument();
    expect(screen.getByText("Offen", { selector: "div" }).closest("li")).toHaveTextContent(
      "1 Mitglied",
    );
    await userEvent.click(ask.getByRole("button", { name: "Anfragen" }));
    await waitFor(() => expect(ask.getByText("Angefragt")).toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/groups");
    await userEvent.click(screen.getByRole("button", { name: "Beitreten" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/groups/5"));
  });

  it("says when nothing is open, when joining fails and when the list fails", async () => {
    serve({
      "GET /api/v1/groups": () =>
        answer(200, { items: [g({ id: 9, kind: "open", how: "listed" })] }),
      "POST /api/v1/groups/9/join": () => problem(404, "no-group"),
    });
    const first = renderWithQuery(<Groups />);
    await userEvent.click(await screen.findByRole("button", { name: "Beitreten" }));
    expect(await screen.findByText("Diese Gruppe gibt es nicht mehr.")).toBeInTheDocument();
    first.unmount();

    let up = false;
    serve({
      "GET /api/v1/groups": () => (up ? answer(200, { items: [] }) : problem(500, "internal")),
    });
    renderWithQuery(<Groups />);
    expect(
      await screen.findByText("Die Gruppen konnten nicht geladen werden."),
    ).toBeInTheDocument();
    up = true;
    await userEvent.click(screen.getByRole("button", { name: "Nochmal versuchen" }));
    expect(await screen.findByText(/keine offene Gruppe/)).toBeInTheDocument();
  });

  it("founds a group", async () => {
    const calls: Sent[] = [];
    let refuse = true;
    serve(
      {
        "POST /api/v1/groups": (sent) =>
          refuse
            ? problem(400, "invalid-group")
            : answer(201, { ...g({ id: 8 }), ...(sent.body as object) }),
      },
      calls,
    );
    const { router } = renderWithQuery(<NewGroup />, { at: "/groups/new" });
    await userEvent.type(screen.getByLabelText("Name"), "Donnerstagsrunde");
    await userEvent.click(screen.getByRole("button", { name: /Offen/ }));
    expect(screen.getByRole("button", { name: /Offen/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Gründen" }));
    expect(await screen.findByText("Ein Name hat 1 bis 40 Zeichen.")).toBeInTheDocument();
    refuse = false;
    await userEvent.click(screen.getByRole("button", { name: "Gründen" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/groups/8"));
    expect(calls[1]!.body).toEqual({ name: "Donnerstagsrunde", kind: "open" });
    expect(calls[0]!.headers.get("Idempotency-Key")).toBe(calls[1]!.headers.get("Idempotency-Key"));
  });
});
