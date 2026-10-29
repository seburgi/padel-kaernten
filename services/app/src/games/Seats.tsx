// The four places of a game as rounds: filled with who is in, dashed where
// one is still wanted. Says at a glance how full a game is.
import type { Game } from "../api/client";
import { playing, shown } from "./games";

export function Seats({ g, big = false }: { g: Game; big?: boolean }) {
  const ins = playing(g);
  const free = Math.max(g.players - ins.length, 0);
  const size = big ? "h-11 w-11 text-sm" : "h-8 w-8 text-xs";
  return (
    <div className="flex gap-1.5" aria-label={`${ins.length} von ${g.players} dabei`} role="img">
      {ins.map((p) => (
        <span
          key={p.email}
          title={shown(p)}
          className={`${size} inline-flex items-center justify-center rounded-full bg-accent font-semibold text-accent-ink`}
        >
          {shown(p).slice(0, 2).toUpperCase()}
        </span>
      ))}
      {Array.from({ length: free }, (_, i) => (
        <span
          key={`free-${i}`}
          className={`${size} inline-flex items-center justify-center rounded-full border-[1.5px] border-dashed border-ink-faint text-ink-faint`}
        >
          ?
        </span>
      ))}
    </div>
  );
}

/** "noch 2 gesucht", or that it is full. */
export function wanted(g: Game): string {
  const n = g.players - playing(g).length;
  return n > 0 ? `noch ${n} gesucht` : "voll";
}
