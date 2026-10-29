// Gruppe fragen (Seb, 2026-10-29): a free start time tapped on Plätze, for
// someone in a group. A sheet says who of each group can then, from the
// group's fits (all four, or three and whom to ask), and proposes it as a
// game with one tap; the venue's own page stays one tap away. Proposing
// checks the court again, as from the fits.
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { api, ApiError, call, useWriteKey, type Fit } from "../api/client";
import { link, primary, quiet } from "../ui";
import { dayLabel, errorText, shown, span } from "./games";

export type Asked = {
  venueId: string;
  venueName: string;
  court: string;
  day: string;
  start: number;
  minutes: number;
  href: string;
};

const same = (f: Fit, s: Asked) =>
  f.venueId === s.venueId && f.court === s.court && f.day === s.day && f.start === s.start;

export function AskGroup({ slot, onClose }: { slot: Asked; onClose: () => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const groups = useQuery({
    queryKey: ["groups"],
    queryFn: async () => (await call(api.GET("/api/v1/groups"))).items,
    retry: false,
  });
  const mine = groups.data?.filter((g) => g.how === "member") ?? [];
  const fits = useQueries({
    queries: mine.map((g) => ({
      queryKey: ["fits", g.id, slot.minutes],
      queryFn: () =>
        call(
          api.GET("/api/v1/groups/{groupId}/fits", {
            params: {
              path: { groupId: g.id },
              query: { minutes: slot.minutes as 60 | 90 | 120 },
            },
          }),
        ),
      retry: false,
      // Fits come in 60, 90 and 120 minutes, as Plätze offers them.
      enabled: [60, 90, 120].includes(slot.minutes),
    })),
  });

  const key = useWriteKey();
  const propose = useMutation({
    mutationFn: (groupId: number) => {
      const body = {
        venueId: slot.venueId,
        court: slot.court,
        day: slot.day,
        start: slot.start,
        minutes: slot.minutes,
      };
      return call(
        api.POST("/api/v1/groups/{groupId}/games", {
          params: { path: { groupId }, header: { "Idempotency-Key": key({ groupId, ...body }) } },
          body,
        }),
      );
    },
    onSuccess: (g) => {
      void client.invalidateQueries({ queryKey: ["games"] });
      navigate(`/games/${g.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.kind === "court-gone")
        void client.invalidateQueries({ queryKey: ["slots"] });
    },
  });

  return (
    <div
      role="dialog"
      aria-label="Gruppe fragen"
      className="fixed inset-x-0 bottom-[calc(var(--size-tabbar)+env(safe-area-inset-bottom))] z-30 mx-auto max-h-[70vh] max-w-3xl overflow-y-auto rounded-t-2xl border-t border-line bg-card px-4 pt-2 pb-4 md:bottom-4 md:rounded-2xl md:border"
    >
      <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-line md:hidden" aria-hidden="true" />
      <h2 className="font-semibold">
        {dayLabel(slot.day)}, {span(slot.start, slot.minutes)} · {slot.venueName}
      </h2>
      <p className="mb-3 text-sm text-ink-muted">{slot.court}</p>
      <ul className="mb-3 space-y-3">
        {mine.map((g, i) => {
          const q = fits[i]?.data;
          const all = q?.fits.find((f) => same(f, slot));
          const three = q?.nearly.find((f) => same(f, slot));
          const who = all
            ? `${all.can.length} können: ${all.can.map(shown).join(", ")}`
            : three
              ? `${three.can.map(shown).join(", ")} können. Frag ${three.ask.map(shown).join(" oder ")}.`
              : q
                ? "Noch nicht vier, die dann können. Wer kann, sagt es mit „Bin dabei“."
                : "";
          return (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold">{g.name}</div>
                <div className="text-sm text-ink-muted">{who}</div>
              </div>
              <button
                type="button"
                className={all ? primary : quiet}
                disabled={propose.isPending}
                onClick={() => propose.mutate(g.id)}
              >
                In {g.name} vorschlagen
              </button>
            </li>
          );
        })}
      </ul>
      {propose.isError && (
        <p role="alert" className="mb-3 text-sm text-danger-text">
          {errorText(propose.error)}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a href={slot.href} target="_blank" rel="noopener" className={`${link} text-sm`}>
          Selbst buchen ↗
        </a>
        <span className="flex items-center gap-3">
          <Link to="/help#spiele" className={`${link} text-sm`}>
            So geht’s
          </Link>
          <button type="button" className={quiet} onClick={onClose}>
            Schließen
          </button>
        </span>
      </div>
    </div>
  );
}
