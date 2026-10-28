import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { answer, problem, serve, type Sent } from "../test/fetch";
import { renderWithQuery } from "../test/render";
import { dayLabel, releaseDays, type ReleaseNote } from "./notes";
import { WhatsNew } from "./WhatsNew";
import { WhatsNewCard } from "./WhatsNewCard";

const note = (slug: string, read = false, extra: Partial<ReleaseNote> = {}): ReleaseNote => ({
  slug,
  date: slug.slice(0, 10),
  area: "courts",
  title: `Note ${slug}`,
  paragraphs: [`About ${slug}.`],
  read,
  ...extra,
});

describe("releaseDays", () => {
  it("groups by day, newest first, keeping the order within a day", () => {
    const days = releaseDays([note("2026-10-27-a"), note("2026-10-28-b"), note("2026-10-27-c")]);
    expect(days.map((d) => d.date)).toEqual(["2026-10-28", "2026-10-27"]);
    expect(days[1]!.notes.map((n) => n.slug)).toEqual(["2026-10-27-a", "2026-10-27-c"]);
  });

  it("names the day in German", () => {
    expect(dayLabel("2026-10-28")).toBe("Mittwoch, 28. Oktober 2026");
  });
});

describe("WhatsNew", () => {
  it("shows the notes and marks the unread ones read", async () => {
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/release-notes": () =>
          answer(200, {
            items: [
              note("2026-10-28-b", false, { link: "/invites", area: "invites" }),
              note("2026-10-27-a", true, { area: "something-new" }),
            ],
          }),
        "POST /api/v1/release-notes/read": () => problem(500, "internal"),
      },
      calls,
    );
    renderWithQuery(<WhatsNew />);
    expect(await screen.findByRole("heading", { name: "Note 2026-10-28-b" })).toBeInTheDocument();
    expect(screen.getByText("Einladen")).toBeInTheDocument();
    expect(screen.getByText("something-new")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ansehen" })).toHaveAttribute("href", "/invites");
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ slugs: ["2026-10-28-b"] });
    expect(post.headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("says when there is nothing yet", async () => {
    const calls: Sent[] = [];
    serve({ "GET /api/v1/release-notes": () => answer(200, { items: [] }) }, calls);
    renderWithQuery(<WhatsNew />);
    expect(await screen.findByText("Noch nichts.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("offers to try again when the notes did not load", async () => {
    let fail = true;
    serve({
      "GET /api/v1/release-notes": () =>
        fail ? problem(500, "internal") : answer(200, { items: [] }),
    });
    renderWithQuery(<WhatsNew />);
    expect(await screen.findByText(/konnten nicht geladen werden/)).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Nochmal versuchen" }));
    expect(await screen.findByText("Noch nichts.")).toBeInTheDocument();
  });
});

describe("WhatsNewCard", () => {
  it("counts what is unread and goes on a tap", async () => {
    const calls: Sent[] = [];
    serve(
      {
        "GET /api/v1/release-notes": () =>
          answer(200, {
            items: [note("2026-10-28-b"), note("2026-10-28-a"), note("2026-10-27-z", true)],
          }),
        "POST /api/v1/release-notes/read": () => answer(204),
      },
      calls,
    );
    renderWithQuery(<WhatsNewCard />);
    expect(await screen.findByText(/2 Neuigkeiten seit deinem letzten Besuch/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Wegklicken" }));
    expect(screen.queryByText(/Neuigkeiten/)).toBeNull();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      slugs: ["2026-10-28-b", "2026-10-28-a"],
    });
  });
});
