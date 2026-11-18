// One free time that fits, as a card: when, where (venue or court), the
// price, the group, who can, and Vorschlagen. Passt für vier, Alle Zeiten
// and Spiel vorschlagen show it; moving a game can later too.
import type { Fit } from "../api/client";
import { card, quiet } from "../ui";
import { clock, dayLabel, euros, shown, span } from "./games";

export function FitRow({
  f,
  withDay,
  group,
  more = 0,
  busy,
  onPropose,
}: {
  f: Fit;
  /** With the day and venue on top; without, the venue and its court. */
  withDay: boolean;
  /** The group's name, when the list holds several. */
  group?: string;
  /** How many other venues are free then. */
  more?: number;
  busy: boolean;
  onPropose: () => void;
}) {
  return (
    <li className={`${card} flex flex-wrap items-center justify-between gap-2 p-4`}>
      <div className="min-w-0">
        <div className="font-semibold">
          {withDay && `${dayLabel(f.day)}, `}
          {span(f.start, f.minutes)}
          {!withDay && ` · ${f.venueName}`}
        </div>
        <div className="text-sm text-ink-muted">
          {withDay ? f.venueName : f.court}
          {f.perHead && ` · ${euros(f.perHead.amount)} pro Kopf`}
          {group && ` · ${group}`}
          {more > 0 && ` · noch ${more} ${more === 1 ? "Anlage" : "Anlagen"} frei`}
        </div>
        <div className="text-sm">
          {f.can.length} können: {f.can.map(shown).join(", ")}
        </div>
      </div>
      <button
        type="button"
        className={quiet}
        disabled={busy}
        aria-label={`${dayLabel(f.day)} ${clock(f.start)} in ${f.venueName} vorschlagen`}
        onClick={onPropose}
      >
        Vorschlagen
      </button>
    </li>
  );
}
