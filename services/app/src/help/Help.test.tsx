import { screen } from "@testing-library/react";
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

  it("scrolls to the chapter a link asks for", () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled(this.id);
    };
    renderWithQuery(<Help />, { at: "/help#spiele" });
    expect(scrolled).toHaveBeenCalledWith("spiele");
  });

  it("keeps the anchors unique", () => {
    expect(new Set(CHAPTERS.map((c) => c.id)).size).toBe(CHAPTERS.length);
  });
});
