// How long a game is, as chips (60, 90, 120 minutes): on Wann passt es für
// vier? and in Spiel vorschlagen, and for moving a game later.
import { pressed } from "../ui";

export const DURATIONS = [60, 90, 120] as const;
export type Duration = (typeof DURATIONS)[number];

export function Durations({
  minutes,
  onChange,
  className = "mb-2",
}: {
  minutes: Duration;
  onChange: (d: Duration) => void;
  className?: string;
}) {
  return (
    <div className={`${className} flex gap-2`} role="group" aria-label="Wie lange?">
      {DURATIONS.map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={minutes === d}
          className={`rounded-full border px-3 py-1.5 text-sm ${pressed(minutes === d)}`}
          onClick={() => onChange(d)}
        >
          {d} Min
        </button>
      ))}
    </div>
  );
}
