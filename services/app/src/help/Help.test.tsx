import { screen, waitFor } from "@testing-library/react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../test/render";
import { CHAPTERS } from "./chapters";
import { Help } from "./Help";

describe("Help", () => {
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("lists every chapter and shows each under its anchor", () => {
    renderWithQuery(<Help />, { at: "/help" });
    expect(screen.getByRole("heading", { level: 1, name: "Hilfe" })).toBeInTheDocument();
    const toc = screen.getByRole("navigation", { name: "Inhalt" });
    for (const c of CHAPTERS) {
      expect(toc.querySelector(`a[href="#${c.id}"]`)).toHaveTextContent(c.title);
      expect(screen.getByRole("region", { name: c.title })).toHaveAttribute("id", c.id);
    }
    expect(screen.getByRole("link", { name: "Kurzer Rundgang" })).toHaveAttribute(
      "href",
      "/welcome",
    );
  });

  it("scrolls to the chapter a link asks for", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled(this.id);
    };
    renderWithQuery(<Help />, { at: "/help#spiele" });
    await waitFor(() => expect(scrolled).toHaveBeenCalledWith("spiele"));
  });

  it("shows each picture light, or dark where the app is set to dark", () => {
    renderWithQuery(<Help />, { at: "/help" });
    const img = screen.getByRole("img", { name: /^Ein vorgeschlagenes Spiel/ });
    expect(img).toHaveAttribute("src", "/help/spiel.webp");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img.parentElement?.querySelector("source")).toHaveAttribute(
      "srcset",
      "/help/spiel-dark.webp",
    );
  });

  it("follows a theme chosen in the app", () => {
    document.cookie = "theme=dark; Path=/";
    try {
      renderWithQuery(<Help />, { at: "/help" });
      const img = screen.getByRole("img", { name: /^Ein vorgeschlagenes Spiel/ });
      expect(img).toHaveAttribute("src", "/help/spiel-dark.webp");
      expect(img.parentElement?.querySelector("source")).toBeNull();
    } finally {
      document.cookie = "theme=; Max-Age=0; Path=/";
    }
  });

  it("has every picture it names, light and dark", () => {
    const named = CHAPTERS.flatMap((c) => c.shots ?? []).map((s) => s.name);
    expect(named.length).toBeGreaterThan(0);
    for (const name of named)
      for (const file of [`${name}.webp`, `${name}-dark.webp`])
        expect(existsSync(join(__dirname, "../../public/help", file)), file).toBe(true);
  });

  it("keeps the anchors unique", () => {
    expect(new Set(CHAPTERS.map((c) => c.id)).size).toBe(CHAPTERS.length);
  });
});
