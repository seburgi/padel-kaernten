import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { answer, problem, serve, type Sent } from "../test/fetch";
import { renderWithQuery } from "../test/render";

const anna = { email: "anna@example.at", canInvite: false };
const note = (slug: string) => ({
  slug,
  date: slug.slice(0, 10),
  area: "app",
  title: `Note ${slug}`,
  paragraphs: ["Was sich geändert hat."],
  read: false,
});

function api(me: { name: string; welcomed: boolean }, calls: Sent[] = []) {
  let current = { ...anna, ...me };
  serve(
    {
      "GET /api/v1/me": () => answer(200, current),
      "PUT /api/v1/me/name": (s) => {
        current = { ...current, name: (s.body as { name: string }).name };
        return answer(200, current);
      },
      "POST /api/v1/me/welcomed": () => {
        current = { ...current, welcomed: true };
        return answer(200, current);
      },
      "GET /api/v1/release-notes": () => answer(200, { items: [note("2026-10-28-hilfe")] }),
      "POST /api/v1/release-notes/read": () => answer(204),
      "GET /api/v1/groups": () => answer(200, { items: [] }),
    },
    calls,
  );
  return calls;
}

describe("Welcome", () => {
  it("greets someone new first, takes their name and goes on where they were going", async () => {
    const calls = api({ name: "", welcomed: false });
    const { router } = renderWithQuery(<App />, { at: "/groups" });
    expect(
      await screen.findByRole("heading", { name: "Willkommen bei Padel Kärnten" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/welcome");
    expect(router.state.location.search).toBe("?next=%2Fgroups");
    // Nothing to catch up on yet.
    expect(screen.queryByText(/seit deinem letzten Besuch/)).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    await userEvent.type(screen.getByLabelText("Wie sollen dich die anderen sehen?"), " Anna ");
    await userEvent.click(screen.getByRole("button", { name: "Los geht’s" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/groups"));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ name: "Anna" });
    expect(calls.some((c) => c.url.pathname === "/api/v1/me/welcomed")).toBe(true);
    await waitFor(() =>
      expect(calls.find((c) => c.url.pathname === "/api/v1/release-notes/read")?.body).toEqual({
        slugs: ["2026-10-28-hilfe"],
      }),
    );
    expect(await screen.findByRole("heading", { name: "Gruppen finden" })).toBeInTheDocument();
  });

  it("lets someone new read the Hilfe, which counts as welcomed", async () => {
    const calls = api({ name: "Anna", welcomed: false });
    const { router } = renderWithQuery(<App />, { at: "/" });
    expect(await screen.findByRole("button", { name: "Alles erklärt" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Wie sollen dich die anderen sehen?")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Alles erklärt" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/help"));
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    expect(calls.some((c) => c.url.pathname === "/api/v1/me/welcomed")).toBe(true);
  });

  it("stays a tour for someone welcomed, and never leads off the app", async () => {
    const calls = api({ name: "Anna", welcomed: true });
    const { router } = renderWithQuery(<App />, { at: "/welcome?next=%2F%2Fevil.example" });
    await userEvent.click(await screen.findByRole("button", { name: "Los geht’s" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/play"));
    expect(calls.some((c) => c.url.pathname === "/api/v1/me/welcomed")).toBe(false);
  });

  it("says so when it could not be recorded", async () => {
    serve({
      "GET /api/v1/me": () => answer(200, { ...anna, name: "Anna", welcomed: false }),
      "GET /api/v1/release-notes": () => answer(200, { items: [] }),
      "POST /api/v1/me/welcomed": () => problem(500, "internal"),
    });
    const { router } = renderWithQuery(<App />, { at: "/welcome" });
    await userEvent.click(await screen.findByRole("button", { name: "Los geht’s" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Das hat nicht geklappt.");
    expect(router.state.location.pathname).toBe("/welcome");
  });
});
