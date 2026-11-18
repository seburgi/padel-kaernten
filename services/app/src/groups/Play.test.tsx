import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { GroupSummary } from "../api/client";
import { answer, problem, serve, type Sent } from "../test/fetch";
import { renderWithQuery } from "../test/render";
import { Groups, NewGroup } from "./Groups";
import { Play, Profile } from "./Play";

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

describe("Profile", () => {
  it("changes the name the others see", async () => {
    let me = { email: "anna@example.at", name: "Anna", canInvite: false };
    serve({
      "GET /api/v1/me": () => answer(200, me),
      "PUT /api/v1/me/name": (sent) => {
        me = { ...me, name: (sent.body as { name: string }).name };
        return answer(200, me);
      },
    });
    renderWithQuery(<Profile />);
    const field = await screen.findByLabelText("Wie sollen dich die anderen sehen?");
    expect(field).toHaveValue("Anna");
    const save = screen.getByRole("button", { name: "Speichern" });
    expect(save).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, "Anni");
    await userEvent.click(save);
    expect(await screen.findByRole("status")).toHaveTextContent("Gespeichert.");
  });
});

describe("Play", () => {
  it("asks for a name, answers invitations and switches between the groups", async () => {
    let me = { email: "anna@example.at", name: "", canInvite: false };
    let items = [
      g({ id: 1, role: "admin" }),
      g({ id: 5, name: "Sonntagsrunde", members: 2 }),
      g({ id: 2, name: "Donnerstagsrunde", how: "invited", members: 1 }),
      g({ id: 3, name: "Morgenrunde", how: "invited" }),
      g({ id: 4, name: "Offene Runde", how: "listed", kind: "on_request", requested: true }),
    ];
    let platformDown = true;
    const calls: Sent[] = [];
    const full = (id: number) => {
      const s = items.find((i) => i.id === id)!;
      return {
        ...s,
        memberList: [
          { email: "anna@example.at", name: "Anna", role: "admin", joinedAt: "", daysEntered: 3 },
        ],
        invitations: [],
        requests: [],
      };
    };
    serve(
      {
        "GET /api/v1/me": () => answer(200, me),
        "PUT /api/v1/me/name": (sent) => {
          me = { ...me, name: (sent.body as { name: string }).name };
          return answer(200, me);
        },
        "GET /api/v1/groups": () => answer(200, { items }),
        "GET /api/v1/groups/1": () => answer(200, full(1)),
        "GET /api/v1/groups/2": () => answer(200, full(2)),
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
    renderWithQuery(
      <Play
        parts={(id, name) => ({ propose: <p>vorschlagen {name}</p>, games: <p>spiele {id}</p> })}
        badge={(id) => (id === 5 ? <span>2</span> : null)}
      />,
    );
    await userEvent.type(
      await screen.findByLabelText("Wie sollen dich die anderen sehen?"),
      " Anna ",
    );
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(screen.queryByLabelText(/Wie sollen dich/)).toBeNull());
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ name: "Anna" });

    // Alle: the chips, the invitations waiting, who one asked.
    const chips = within(screen.getByRole("navigation", { name: "Deine Gruppen" }));
    expect(chips.getByRole("link", { name: "Alle" })).toHaveAttribute("aria-current", "page");
    expect(chips.getByRole("link", { name: "Sonntagsrunde2" })).toHaveAttribute(
      "href",
      "/groups/5",
    );
    expect(screen.getByText("Angefragt: Offene Runde")).toBeInTheDocument();
    const thursday = screen.getByText("Donnerstagsrunde").closest("li")!;
    expect(thursday).toHaveTextContent("1 Mitglied");
    await userEvent.click(within(thursday).getByRole("button", { name: "Annehmen" }));
    expect(await screen.findByText(/Die Anmeldung hat nicht geantwortet/)).toBeInTheDocument();
    platformDown = false;
    await userEvent.click(within(thursday).getByRole("button", { name: "Annehmen" }));

    // Joined, the group is chosen: its parts, members and Verwalten.
    expect(await screen.findByText("vorschlagen Donnerstagsrunde")).toBeInTheDocument();
    expect(screen.getByText("spiele 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Verwalten" })).toHaveAttribute(
      "href",
      "/groups/2/settings",
    );
    expect(screen.getByRole("link", { name: "Donnerstagsrunde" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(localStorage.getItem("padel.play.group")).toBe("2");

    // The invitation left still shows here, and goes.
    const morning = screen.getByText("Morgenrunde").closest("li")!;
    await userEvent.click(within(morning).getByRole("button", { name: "Ablehnen" }));
    await waitFor(() => expect(screen.queryByText("Morgenrunde")).toBeNull());
    expect(screen.queryByText("Einladungen")).toBeNull();

    // Another group, then Alle again.
    await userEvent.click(screen.getByRole("link", { name: "Padel Kärnten" }));
    expect(await screen.findByText("vorschlagen Padel Kärnten")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Alle" }));
    await waitFor(() => expect(screen.queryByText(/vorschlagen/)).toBeNull());
    expect(localStorage.getItem("padel.play.group")).toBe("all");

    // + Gruppe: founding one, or one that is open.
    await userEvent.click(screen.getByRole("button", { name: "+ Gruppe" }));
    expect(await screen.findByRole("link", { name: "Neue Gruppe gründen" })).toHaveAttribute(
      "href",
      "/groups/new",
    );
    await userEvent.click(screen.getAllByRole("button", { name: "Schließen" }).at(-1)!);
  });

  it("is the group for someone in one, and keeps the choice of several", async () => {
    let items = [g({ id: 1 })];
    serve({
      "GET /api/v1/me": () => answer(200, { email: "a@example.at", name: "A", canInvite: false }),
      "GET /api/v1/groups": () => answer(200, { items }),
      "GET /api/v1/groups/1": () =>
        answer(200, { ...items[0], memberList: [], invitations: [], requests: [] }),
      "GET /api/v1/groups/7": () =>
        answer(200, { ...items[1], memberList: [], invitations: [], requests: [] }),
    });
    const one = renderWithQuery(<Play parts={(id) => ({ games: <p>spiele {id}</p> })} />);
    expect(await screen.findByText("spiele 1")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Alle" })).toBeNull();
    one.unmount();

    items = [g({ id: 1 }), g({ id: 7, name: "Zweite" })];
    localStorage.setItem("padel.play.group", "7");
    renderWithQuery(<Play parts={(id) => ({ games: <p>spiele {id}</p> })} />);
    expect(await screen.findByText("spiele 7")).toBeInTheDocument();
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
