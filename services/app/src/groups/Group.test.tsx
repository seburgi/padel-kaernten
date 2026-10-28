import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import type { Group as G } from "../api/client";
import { answer, problem, serve, type Sent } from "../test/fetch";
import { renderWithQuery } from "../test/render";
import { Group } from "./Group";

const at = "2026-10-28T07:00:00Z";
const member = (email: string, name: string, role = "member", daysEntered = 0) => ({
  email,
  name,
  role,
  joinedAt: at,
  daysEntered,
});

const group = (over: Partial<G> = {}): G => ({
  id: 1,
  name: "Padel Kärnten",
  kind: "private",
  how: "member",
  role: "admin",
  members: 3,
  requested: false,
  memberList: [
    member("seb@example.at", "Seb", "admin", 5),
    member("anna@example.at", "Anna", "member", 1),
    member("markus@example.at", ""),
  ],
  invitations: [
    { email: "lisa@example.at", invitedBy: "seb@example.at", invitedAt: at },
    { email: "bert@example.at", invitedBy: "anna@example.at", invitedAt: at },
  ],
  requests: [
    { email: "eva@example.at", name: "Eva", askedAt: at },
    { email: "tom@example.at", name: "", askedAt: at },
  ],
  ...over,
});

const me = (email: string) => () => answer(200, { email, name: "", canInvite: false });

// The screen reads its id from the path, as under the app's routes.
function show(path = "/groups/1") {
  return renderWithQuery(
    <Routes>
      <Route path="/groups/:id" element={<Group />} />
      <Route path="*" element={<p>woanders</p>} />
    </Routes>,
    { at: path },
  );
}

describe("Group", () => {
  it("shows the members to an admin and lets them run the group", async () => {
    let g = group();
    const calls: Sent[] = [];
    const inviteFails: string[] = ["invite-limit", "already-member", "invalid-email"];
    serve(
      {
        "GET /api/v1/me": me("seb@example.at"),
        "GET /api/v1/groups/1": () => answer(200, g),
        "POST /api/v1/groups/1/invitations": (sent) => {
          const kind = inviteFails.shift();
          if (kind) return problem(kind === "invite-limit" ? 429 : 400, kind);
          const email = (sent.body as { email: string }).email;
          const inv = { email, invitedBy: "seb@example.at", invitedAt: at };
          g = { ...g, invitations: [...g.invitations, inv] };
          return answer(201, inv);
        },
        "DELETE /api/v1/groups/1/invitations/bert@example.at": () => {
          g = { ...g, invitations: g.invitations.filter((i) => i.email !== "bert@example.at") };
          return answer(204);
        },
        "PUT /api/v1/groups/1/members/eva@example.at": () => {
          g = {
            ...g,
            requests: g.requests.filter((r) => r.email !== "eva@example.at"),
            memberList: [...g.memberList, member("eva@example.at", "Eva")],
          };
          return answer(204);
        },
        "DELETE /api/v1/groups/1/requests/tom@example.at": () => problem(403, "not-allowed"),
        "DELETE /api/v1/groups/1/members/markus@example.at": () => {
          g = { ...g, memberList: g.memberList.filter((m) => m.email !== "markus@example.at") };
          return answer(204);
        },
        "PATCH /api/v1/groups/1": (sent) => {
          g = { ...g, ...(sent.body as object) };
          return answer(200, g);
        },
      },
      calls,
    );
    show();
    expect(await screen.findByRole("heading", { name: "Padel Kärnten" })).toBeInTheDocument();
    expect(screen.getByText("Privat · 3 Mitglieder")).toBeInTheDocument();
    const seb = screen.getByText(/Seb/, { selector: "div" }).closest("li")!;
    expect(seb).toHaveTextContent("Seb (du)Admin");
    expect(seb).toHaveTextContent("Zeiten an 5 von 14 Tagen");
    expect(within(seb).queryByRole("button")).toBeNull();
    expect(screen.getByText("markus@example.at").closest("li")).toHaveTextContent(
      "hat noch keine Zeiten eingetragen",
    );

    // Requests: let Eva in; turning Tom down is refused.
    const eva = screen.getByText("Eva", { selector: "span" }).closest("li")!;
    await userEvent.click(within(eva).getByRole("button", { name: "Hereinlassen" }));
    await waitFor(() => expect(screen.queryByText("Eva", { selector: "span" })).toBeNull());
    expect(screen.getByText("Eva", { selector: "div" })).toBeInTheDocument();
    const tom = screen.getByText("tom@example.at").closest("li")!;
    await userEvent.click(within(tom).getByRole("button", { name: "Ablehnen" }));
    expect(await screen.findByText("Das dürfen nur die Admins der Gruppe.")).toBeInTheDocument();

    // Invite: the limit, a member, a bad address, then it works.
    const box = screen.getByLabelText("E-Mail-Adresse");
    await userEvent.type(box, "neu@example.at");
    for (const text of [/höchstens 20 offene/, /schon in der Gruppe/, /keine E-Mail-Adresse/]) {
      await userEvent.click(screen.getByRole("button", { name: "Einladen" }));
      expect(await screen.findByText(text)).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole("button", { name: "Einladen" }));
    expect(await screen.findByText(/neu@example.at ist eingeladen/)).toBeInTheDocument();
    const posts = calls.filter((c) => c.method === "POST");
    expect(new Set(posts.map((c) => c.headers.get("Idempotency-Key"))).size).toBe(1);
    expect(await screen.findByText("neu@example.at", { selector: "div" })).toBeInTheDocument();

    // An admin takes back anyone's invitation.
    expect(screen.getByText("lisa@example.at").closest("li")).toHaveTextContent(
      "eingeladen von dir",
    );
    const bert = screen.getByText("bert@example.at").closest("li")!;
    await userEvent.click(within(bert).getByRole("button", { name: "Zurücknehmen" }));
    await waitFor(() => expect(screen.queryByText("bert@example.at")).toBeNull());

    // Remove Markus, after asking.
    const markus = screen.getByText("markus@example.at").closest("li")!;
    await userEvent.click(within(markus).getByRole("button", { name: "Entfernen …" }));
    await userEvent.click(within(markus).getByRole("button", { name: "Abbrechen" }));
    await userEvent.click(within(markus).getByRole("button", { name: "Entfernen …" }));
    await userEvent.click(within(markus).getByRole("button", { name: "Entfernen" }));
    await waitFor(() => expect(screen.queryByText("markus@example.at")).toBeNull());

    // Settings: rename and change who may join.
    const name = screen.getByLabelText("Name der Gruppe");
    expect(screen.getByRole("button", { name: "Umbenennen" })).toBeDisabled();
    await userEvent.clear(name);
    await userEvent.type(name, "PK");
    await userEvent.click(screen.getByRole("button", { name: "Umbenennen" }));
    expect(await screen.findByRole("heading", { name: "PK" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Privat" }));
    await userEvent.click(screen.getByRole("button", { name: "Offen" }));
    expect(await screen.findByText("Alle sehen sie und können beitreten.")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([
      { name: "PK" },
      { kind: "open" },
    ]);
  });

  it("lets a member invite and leave, but not run the group", async () => {
    const g = group({ role: "member" });
    serve({
      "GET /api/v1/me": me("anna@example.at"),
      "GET /api/v1/groups/1": () => answer(200, g),
      "DELETE /api/v1/groups/1/members/anna@example.at": () => answer(204),
      "DELETE /api/v1/groups/1/invitations/bert@example.at": () => problem(502, "platform-failed"),
      "PATCH /api/v1/groups/1": () => problem(403, "not-allowed"),
    });
    const { router } = show();
    await screen.findByRole("heading", { name: "Padel Kärnten" });
    expect(screen.queryByText("Einstellungen")).toBeNull();
    expect(screen.queryByRole("button", { name: "Entfernen …" })).toBeNull();
    // Only her own invitation can she take back.
    expect(
      within(screen.getByText("lisa@example.at").closest("li")!).queryByRole("button"),
    ).toBeNull();
    const bert = screen.getByText("bert@example.at").closest("li")!;
    await userEvent.click(within(bert).getByRole("button", { name: "Zurücknehmen" }));
    expect(await screen.findByText(/Die Anmeldung hat nicht geantwortet/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Gruppe verlassen …" }));
    expect(screen.getByText(/Wirklich hinaus/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    await userEvent.click(screen.getByRole("button", { name: "Gruppe verlassen …" }));
    await userEvent.click(screen.getByRole("button", { name: "Verlassen" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/play"));
  });

  it("warns the last one, and says when leaving or settings fail", async () => {
    const g = group({
      members: 1,
      memberList: [member("seb@example.at", "Seb", "admin")],
      requests: [],
      invitations: [],
    });
    serve({
      "GET /api/v1/me": me("seb@example.at"),
      "GET /api/v1/groups/1": () => answer(200, g),
      "DELETE /api/v1/groups/1/members/seb@example.at": () => problem(500, "internal"),
      "PATCH /api/v1/groups/1": () => problem(400, "invalid-group"),
    });
    show();
    await screen.findByText("Privat · 1 Mitglied");
    expect(screen.queryByText("Möchten hinein")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Auf Anfrage" }));
    expect(await screen.findByText("Ein Name hat 1 bis 40 Zeichen.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Gruppe verlassen …" }));
    expect(screen.getByText(/als Letzte oder Letzter/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Verlassen" }));
    expect(
      await screen.findByText("Das hat nicht geklappt. Versuch es nochmal."),
    ).toBeInTheDocument();
  });

  it("lets someone outside join, accept or ask", async () => {
    let g = group({ how: "listed", kind: "open", role: undefined, invitations: [], requests: [] });
    serve({
      "GET /api/v1/me": me("eva@example.at"),
      "GET /api/v1/groups/1": () => answer(200, g),
      "POST /api/v1/groups/1/join": () => problem(429, "rate-limited"),
    });
    const first = show();
    await userEvent.click(await screen.findByRole("button", { name: "Beitreten" }));
    expect(
      await screen.findByText("Das hat nicht geklappt. Versuch es nochmal."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Einladen")).toBeNull();
    expect(screen.queryByText(/Gruppe verlassen/)).toBeNull();
    first.unmount();

    for (const [how, kind, label] of [
      ["invited", "open", "Annehmen"],
      ["listed", "on_request", "Anfragen"],
    ]) {
      g = { ...g, how: how!, kind: kind! };
      const view = show();
      expect(await screen.findByRole("button", { name: label })).toBeInTheDocument();
      view.unmount();
    }
    g = { ...g, kind: "on_request", requested: true };
    show();
    expect(await screen.findByText(/Du hast gefragt/)).toBeInTheDocument();
  });

  it("says when there is no such group, and when it does not load", async () => {
    let up = false;
    serve({
      "GET /api/v1/me": me("eva@example.at"),
      "GET /api/v1/groups/2": () => problem(404, "no-group"),
      "GET /api/v1/groups/1": () => (up ? answer(200, group()) : problem(500, "internal")),
    });
    const a = show("/groups/2");
    expect(await screen.findByRole("heading", { name: "Keine Gruppe" })).toBeInTheDocument();
    a.unmount();
    const b = show("/groups/nope");
    expect(await screen.findByRole("heading", { name: "Keine Gruppe" })).toBeInTheDocument();
    b.unmount();
    show();
    expect(await screen.findByText("Die Gruppe konnte nicht geladen werden.")).toBeInTheDocument();
    up = true;
    await userEvent.click(screen.getByRole("button", { name: "Nochmal versuchen" }));
    expect(await screen.findByRole("heading", { name: "Padel Kärnten" })).toBeInTheDocument();
  });
});
