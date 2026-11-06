// The page Mitteilungen (/notifications, Seb 2026-11-04): this browser's
// switch on top, then every kind of message, each on or off for the
// person on all their browsers (docs/design/notify.md).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, call, newKey } from "../api/client";
import type { components } from "../api/schema";
import { card } from "../ui";
import { PushCard } from "./PushCard";
import { PageHead } from "../PageHead";

type Kinds = components["schemas"]["PushKinds"];

/** What each kind is, in the person's words. */
export const KIND_TEXT: Record<string, { label: string; note: string }> = {
  game: {
    label: "Spiele deiner Gruppen",
    note: "Neue Vorschläge, wenn ihr vier seid, Nachrücken, Gebucht und Abgesagt.",
  },
  before: { label: "Am Vortag", note: "Eine Erinnerung am Abend vor deinem gebuchten Spiel." },
  stale: {
    label: "Dein Vorschlag wackelt",
    note: "Wenn deinem Spiel einen Tag vorher noch Leute fehlen.",
  },
  fits: {
    label: "Es passt für vier",
    note: "Wenn in den nächsten drei Tagen vier können und ein Platz 90 Minuten frei ist.",
  },
  missing: {
    label: "Du fehlst noch",
    note: "Wenn einem Spiel nur noch eine Person fehlt und du Zeit haben könntest.",
  },
  remind: {
    label: "Wann kannst du?",
    note: "Sonntags, wenn 5 oder mehr deiner nächsten 14 Tage noch offen sind.",
  },
};

const KEY = ["push", "kinds"];

export function Notifications() {
  const client = useQueryClient();
  const kinds = useQuery({
    queryKey: KEY,
    queryFn: () => call(api.GET("/api/v1/push/kinds")),
  });
  const set = useMutation({
    mutationFn: ({ kind, on }: { kind: string; on: boolean }) =>
      call(
        api.PUT("/api/v1/push/kinds/{kind}", {
          params: { path: { kind }, header: { "Idempotency-Key": newKey() } },
          body: { on },
        }),
      ),
    onMutate: ({ kind, on }) =>
      client.setQueryData<Kinds>(
        KEY,
        (k) => k && { items: k.items.map((i) => (i.kind === kind ? { ...i, on } : i)) },
      ),
    onSuccess: (k) => client.setQueryData(KEY, k),
    onError: () => void client.invalidateQueries({ queryKey: KEY }),
  });
  const items = kinds.data?.items ?? [];
  return (
    <main>
      <PageHead title="Mitteilungen">
        Was dir die App schickt. Der Schalter oben gilt für dieses Gerät, die Auswahl darunter für
        alle deine Geräte.
      </PageHead>
      <PushCard where="page" />
      {items.length > 0 && (
        <ul className={`${card} m-0 list-none divide-y divide-line p-0`} aria-label="Arten">
          {items.map((k) => {
            const text = KIND_TEXT[k.kind] ?? { label: k.kind, note: "" };
            const id = `kind-${k.kind}`;
            return (
              <li key={k.kind}>
                <label htmlFor={id} className="flex cursor-pointer items-start gap-3 px-4 py-3">
                  <span className="flex-1">
                    <span className="block font-medium">{text.label}</span>
                    <span className="block text-sm text-ink-muted">{text.note}</span>
                  </span>
                  <input
                    id={id}
                    type="checkbox"
                    role="switch"
                    className="mt-1 size-6 shrink-0 accent-accent"
                    checked={k.on}
                    onChange={(e) => set.mutate({ kind: k.kind, on: e.target.checked })}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {set.isError && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          Das hat nicht geklappt. Versuch es bitte nochmal.
        </p>
      )}
      {items.length > 0 && (
        <p className="mt-3 text-sm text-ink-muted">
          Von „Es passt für vier“, „Du fehlst noch“ und „Wann kannst du?“ kommt höchstens eine
          Mitteilung am Tag.
        </p>
      )}
    </main>
  );
}
