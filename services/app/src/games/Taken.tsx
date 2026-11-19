// When the latest court data show the court of a proposed game taken (Seb,
// 2026-11-16; courtTaken, docs/design/games.md): a mark on the game's card
// on the group's page and on Spielen, and on the game itself what to do.
// The proposer may have booked it and not said Gebucht yet, so neither
// says it was someone else.
import type { Game } from "../api/client";
import { primary } from "../ui";
import { shown } from "./games";

/** The short mark on a game's card. */
export function TakenMark({ g }: { g: Game }) {
  if (!g.courtTaken) return null;
  return (
    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-warning-border bg-warning-subtle px-2 text-[13px] font-semibold text-warning-text">
      <span aria-hidden="true">!</span> Platz nicht mehr frei
    </span>
  );
}

/** The warning on the game's own page. */
export function TakenNote({
  g,
  proposer,
  onMove,
}: {
  g: Game;
  proposer: boolean;
  onMove?: () => void;
}) {
  if (!g.courtTaken) return null;
  return (
    <div
      role="status"
      className="mt-3 rounded-2xl border border-warning-border bg-warning-subtle p-4 text-sm"
    >
      <p className="mb-1 font-semibold text-warning-text">Der Platz ist nicht mehr frei</p>
      <p>
        Laut den neuesten Platzdaten ist {g.court} bei {g.venueName} zu dieser Zeit belegt.{" "}
        {proposer
          ? "Hast du schon gebucht? Dann tippe unten auf „Gebucht“. Sonst verschieb das Spiel: alle bekommen Bescheid und sagen neu zu."
          : `Vielleicht hat ${shown(g.proposedBy)} schon gebucht und es nur noch nicht eingetragen. Frag am besten nach.`}
      </p>
      {proposer && (
        <button type="button" className={`${primary} mt-3`} onClick={onMove}>
          Spiel verschieben
        </button>
      )}
    </div>
  );
}
