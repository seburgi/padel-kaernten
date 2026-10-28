// Gruppen finden, and founding one (docs/design/groups.md). The groups one
// can see but is not in: open ones to join, ones on request to ask into.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, call, useWriteKey } from "../api/client";
import { card, field, link, pressed, primary, quiet } from "../ui";
import { errorText, KINDS, kindLabel, useGroups, useJoin } from "./groups";

export function Groups() {
  const groups = useGroups();
  const navigate = useNavigate();
  const join = useJoin((id, state) => {
    if (state === "member") navigate(`/groups/${id}`);
  });
  const listed = groups.data?.filter((g) => g.how === "listed") ?? [];

  return (
    <main>
      <h1 className="mt-2 mb-1 text-2xl font-semibold">Gruppen finden</h1>
      <p className="mb-4 text-ink-muted">
        Gruppen, die offen sind oder Leute auf Anfrage hereinlassen. Private Gruppen siehst du nur
        mit Einladung.{" "}
        <Link to="/help#gruppen" className={link}>
          So geht’s
        </Link>
      </p>
      <Link to="/groups/new" className={`${primary} mb-6`}>
        Neue Gruppe gründen
      </Link>
      {groups.isPending && (
        <div aria-busy="true" aria-label="Lädt">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="mb-2 h-16 animate-skeleton rounded-2xl border border-line bg-sunken"
            />
          ))}
        </div>
      )}
      {groups.isError && (
        <div className={`${card} p-4`} role="alert">
          <p className="mb-3">Die Gruppen konnten nicht geladen werden.</p>
          <button type="button" className={quiet} onClick={() => void groups.refetch()}>
            Nochmal versuchen
          </button>
        </div>
      )}
      {groups.data && listed.length === 0 && (
        <p className="text-ink-muted">Gerade gibt es keine offene Gruppe, in der du nicht bist.</p>
      )}
      {listed.length > 0 && (
        <ul className="space-y-2">
          {listed.map((g) => (
            <li key={g.id} className={`${card} flex flex-wrap items-center gap-3 p-4`}>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{g.name}</div>
                <div className="text-sm text-ink-muted">
                  {g.members} {g.members === 1 ? "Mitglied" : "Mitglieder"} · {kindLabel(g.kind)}
                </div>
              </div>
              {g.requested ? (
                <span className="text-sm text-ink-muted">Angefragt</span>
              ) : (
                <button
                  type="button"
                  className={quiet}
                  disabled={join.isPending}
                  onClick={() => join.mutate(g.id)}
                >
                  {g.kind === "open" ? "Beitreten" : "Anfragen"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {join.isError && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {errorText(join.error)}
        </p>
      )}
    </main>
  );
}

export function NewGroup() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("private");
  const key = useWriteKey();
  const create = useMutation({
    mutationFn: (body: { name: string; kind: string }) =>
      call(
        api.POST("/api/v1/groups", {
          params: { header: { "Idempotency-Key": key(body) } },
          body,
        }),
      ),
    onSuccess: (g) => {
      void client.invalidateQueries({ queryKey: ["groups"] });
      navigate(`/groups/${g.id}`);
    },
  });

  return (
    <main>
      <h1 className="mt-2 mb-4 text-2xl font-semibold">Neue Gruppe</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate({ name: name.trim(), kind });
        }}
      >
        <label htmlFor="group-name" className="mb-1 block font-semibold">
          Name
        </label>
        <input
          id="group-name"
          className={`${field} mb-4 w-full`}
          placeholder="Donnerstagsrunde"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <fieldset className="mb-4">
          <legend className="mb-1 font-semibold">Wer kann hinein?</legend>
          <div className="space-y-2">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                aria-pressed={kind === k.kind}
                className={`block w-full rounded-xl border px-4 py-2.5 text-left ${pressed(kind === k.kind)}`}
                onClick={() => setKind(k.kind)}
              >
                <span className="block font-semibold">{k.label}</span>
                <span className="block text-sm opacity-80">{k.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex gap-2">
          <button
            type="submit"
            className={primary}
            disabled={!name.trim() || create.isPending}
            aria-busy={create.isPending}
          >
            {create.isPending ? "Gründet …" : "Gründen"}
          </button>
          <Link to="/play" className={quiet}>
            Abbrechen
          </Link>
        </div>
        {create.isError && (
          <p role="alert" className="mt-2 text-sm text-danger-text">
            {errorText(create.error)}
          </p>
        )}
      </form>
    </main>
  );
}
