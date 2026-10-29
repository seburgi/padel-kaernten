// Dein erstes Spiel (Seb, 2026-10-29): on Spielen, the three steps of the
// welcome as a card, until each is done: a name, some times in the next
// two weeks, a group. The next step has the one button. Done, it goes;
// it comes back only if all times run out or one leaves every group,
// which is when it helps again. Reads the API itself, since the help
// slice imports no other.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, call } from "../api/client";
import { card, primary } from "../ui";

export function FirstSteps() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => call(api.GET("/api/v1/me")),
    retry: false,
  });
  const times = useQuery({
    queryKey: ["availability"],
    queryFn: () => call(api.GET("/api/v1/availability")),
    retry: false,
  });
  const groups = useQuery({
    queryKey: ["groups"],
    queryFn: async () => (await call(api.GET("/api/v1/groups"))).items,
    retry: false,
  });
  if (!me.data || !times.data || !groups.data) return null;

  const steps = [
    {
      title: "Name",
      text: me.data.name
        ? `Die anderen sehen dich als „${me.data.name}“.`
        : "Gleich hier darunter: wie dich die anderen sehen.",
      done: me.data.name !== "",
    },
    {
      title: "Sag, wann du kannst",
      text: "Ein paar Tage in den nächsten zwei Wochen reichen.",
      done: times.data.days.some((d) => d.spans.length > 0),
      to: "/availability",
      action: "Zeiten eintragen",
    },
    {
      title: "Spiel mit einer Gruppe",
      text: "Nimm eine Einladung an, oder tritt einer Gruppe bei. Sobald vier können, siehst du es hier.",
      done: groups.data.some((g) => g.how === "member"),
      to: "/groups",
      action: "Gruppe finden",
    },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const now = steps.findIndex((s) => !s.done);
  // The name is asked right below the card; the button is for the next
  // step that leads elsewhere.
  const next = steps.find((s) => !s.done && s.to);
  const invited = groups.data.some((g) => g.how === "invited");

  return (
    <section className={`${card} mb-4 p-4`} aria-labelledby="first-steps">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="first-steps" className="font-semibold">
          Dein erstes Spiel
        </h2>
        <span className="text-sm text-ink-muted">
          {done} von {steps.length}
        </span>
      </div>
      <div className="mb-3 flex gap-1" aria-hidden="true">
        {steps.map((s) => (
          <span
            key={s.title}
            className={`h-1 flex-1 rounded-full ${s.done ? "bg-accent" : "bg-line"}`}
          />
        ))}
      </div>
      <ol className="mb-3 space-y-2">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className={`flex gap-3 ${!s.done && i !== now ? "text-ink-faint" : ""}`}
            aria-current={i === now ? "step" : undefined}
          >
            <span
              className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] text-xs font-bold ${
                s.done
                  ? "border-accent bg-accent text-accent-ink"
                  : i === now
                    ? "border-accent text-accent-text"
                    : "border-ink-faint"
              }`}
            >
              {s.done ? "✓" : i + 1}
            </span>
            <span>
              <span className="block font-semibold">{s.title}</span>
              <span className="text-sm text-ink-muted">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
      {/* An invitation waits above; the step needs no other button then. */}
      {next?.to && !(next === steps[2] && invited) && (
        <Link to={next.to} className={`${primary} w-full`}>
          {next.action}
        </Link>
      )}
    </section>
  );
}
