// The way to turn Mitteilungen on (docs/design/notify.md): on Spielen, and
// on a game for whoever just proposed it. Quiet once they are on: Spielen
// says so in a line with the way to turn them off, a game says nothing.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { card, link, primary } from "../ui";
import { turnOff, turnOn, usePush } from "./push";

export function PushCard({ where }: { where: "play" | "game" }) {
  const push = usePush();
  const client = useQueryClient();
  const settled = () => void client.invalidateQueries({ queryKey: ["push"] });
  const on = useMutation({ mutationFn: (key: string) => turnOn(key), onSettled: settled });
  const off = useMutation({ mutationFn: () => turnOff(), onSettled: settled });

  const d = push.data;
  if (!d?.publicKey) return null;
  if (d.can === "on")
    return where === "play" ? (
      <p className="mb-4 text-sm text-ink-muted">
        Mitteilungen sind an.{" "}
        <button
          type="button"
          className={link}
          disabled={off.isPending}
          onClick={() => off.mutate()}
        >
          Ausschalten
        </button>
      </p>
    ) : null;
  if (d.can === "none") return null;
  if (d.can === "blocked")
    return where === "play" ? (
      <p className="mb-4 text-sm text-ink-muted">
        Mitteilungen sind für diese Seite blockiert. Erlauben kannst du sie in den Einstellungen
        deines Browsers.
      </p>
    ) : null;

  const publicKey = d.publicKey;
  return (
    <section className={`${card} mb-6 p-4`}>
      <h2 className="mb-1 font-semibold">
        {where === "game" ? "Erfahren, wer zusagt?" : "Mitteilungen"}
      </h2>
      <p className="mb-3 text-sm text-ink-muted">
        {where === "game"
          ? "Die App sagt dir Bescheid, wenn ihr vier seid, wenn gebucht ist und wenn du nachrückst."
          : "Die App sagt dir Bescheid, wenn jemand ein Spiel vorschlägt, wenn ihr vier seid und wenn gebucht ist."}
      </p>
      {d.can === "home" ? (
        <p className="text-sm">
          Auf dem iPhone geht das, wenn Padel Kärnten auf dem Home-Bildschirm liegt: in Safari
          Teilen, dann „Zum Home-Bildschirm“.
        </p>
      ) : (
        <button
          type="button"
          className={primary}
          disabled={on.isPending}
          onClick={() => on.mutate(publicKey)}
        >
          Mitteilungen einschalten
        </button>
      )}
      {(on.isError || on.data === false) && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {on.isError
            ? "Das hat nicht geklappt. Versuch es bitte nochmal."
            : "Ohne deine Erlaubnis kann die App dir nichts schicken."}
        </p>
      )}
    </section>
  );
}
