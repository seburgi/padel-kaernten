// Hilfe (docs/design/help.md): every part of the app on one page, a chapter
// each, with an anchor every screen can link to (/help#gruppen). The text
// lives here, next to the code it describes, and changes with it.
import { useEffect } from "react";
import { Link, useLocation } from "react-router";
import { card, link } from "../ui";
import { CHAPTERS } from "./chapters";

export function Help() {
  const { hash } = useLocation();
  // The frame scrolls to the top on every new path; a chapter asked for by
  // its anchor is scrolled to after that.
  useEffect(() => {
    if (!hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash]);

  return (
    <main>
      <h1 className="mt-2 mb-1 text-2xl font-semibold">Hilfe</h1>
      <p className="mb-4 text-ink-muted">
        Alles, was Padel Kärnten kann, und wie es geht. Neu hier?{" "}
        <Link to="/welcome" className={link}>
          Kurzer Rundgang
        </Link>
      </p>
      <nav aria-label="Inhalt" className={`${card} mb-6 p-4`}>
        <h2 className="mb-2 text-sm font-semibold text-ink-muted">Inhalt</h2>
        <ol className="grid grid-cols-2 gap-x-4 text-[15px]">
          {CHAPTERS.map((c) => (
            <li key={c.id}>
              <a href={`#${c.id}`} className={`${link} inline-flex py-1.5`}>
                {c.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {CHAPTERS.map((c) => (
        <section
          key={c.id}
          id={c.id}
          aria-labelledby={`${c.id}-title`}
          className="mb-8 scroll-mt-4"
        >
          <h2 id={`${c.id}-title`} className="mb-1 text-xl font-semibold">
            {c.title}
          </h2>
          <p className="mb-3 text-ink-muted">{c.lead}</p>
          <div className="flex flex-col gap-3">{c.body}</div>
        </section>
      ))}
    </main>
  );
}
