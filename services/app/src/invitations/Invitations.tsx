// Seb's invitations: who may use Padel (docs/design/invitations.md). An
// invitation puts the person into the sign-in group padel; withdrawing it
// takes them out again.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api, ApiError, call, newKey, type Invitation, type InvitationPage } from "../api/client";
import { card, danger, field, link, primary, quiet } from "../ui";

const ADDRESS = "padel.burgstaller.me";

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.kind === "invalid-email")
      return "Das ist keine E-Mail-Adresse. Schreib eine wie name@example.at.";
    if (e.kind === "platform-failed")
      return "Die Anmeldung hat nicht geantwortet. Es wurde nichts geändert, versuch es nochmal.";
    if (e.kind === "not-owner") return "Nur Seb kann einladen.";
  }
  return "Das hat nicht geklappt. Versuch es nochmal.";
}

export function Invitations() {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["invitations"],
    queryFn: async () => {
      const items: Invitation[] = [];
      let cursor: string | undefined;
      do {
        const page: InvitationPage = await call(
          api.GET("/api/v1/invitations", { params: { query: { limit: 200, cursor } } }),
        );
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return items;
    },
    retry: false,
  });

  const [email, setEmail] = useState("");
  // One key per address typed, so a retry of the same invitation reuses it.
  const key = useRef<{ email: string; key: string } | null>(null);
  const invite = useMutation({
    mutationFn: (address: string) => {
      if (key.current?.email !== address) key.current = { email: address, key: newKey() };
      return call(
        api.POST("/api/v1/invitations", {
          params: { header: { "Idempotency-Key": key.current.key } },
          body: { email: address },
        }),
      );
    },
    onSuccess: (inv) => {
      key.current = null;
      setEmail("");
      setInvited(inv.email);
      void client.invalidateQueries({ queryKey: ["invitations"] });
    },
  });
  const [invited, setInvited] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const withdraw = useMutation({
    mutationFn: (address: string) =>
      call(api.DELETE("/api/v1/invitations/{email}", { params: { path: { email: address } } })),
    onSuccess: () => {
      setAsking(null);
      void client.invalidateQueries({ queryKey: ["invitations"] });
    },
  });

  return (
    <main>
      <h1 className="mt-2 mb-1 text-2xl font-semibold">Einladen</h1>
      <p className="mb-4 text-ink-muted">
        Nur wer eingeladen ist, kommt auf {ADDRESS}. Die Person meldet sich dort mit Google an, oder
        setzt mit der E-Mail der Anmeldung ein Passwort.
      </p>

      <form
        className="mb-2 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) invite.mutate(email.trim());
        }}
      >
        <label className="sr-only" htmlFor="invite-email">
          E-Mail-Adresse
        </label>
        <input
          id="invite-email"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="name@example.at"
          className={`${field} min-w-0 flex-1`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          type="submit"
          className={primary}
          disabled={!email.trim() || invite.isPending}
          aria-busy={invite.isPending}
        >
          {invite.isPending ? "Lädt ein …" : "Einladen"}
        </button>
      </form>
      {invite.isError && (
        <p role="alert" className="mb-3 text-sm text-danger-text">
          {errorText(invite.error)}
        </p>
      )}
      {invited && !invite.isError && (
        <p role="status" className="mb-3 text-sm text-success-text">
          {invited} ist eingeladen. Schick ihr oder ihm den Link https://{ADDRESS}.
        </p>
      )}

      <h2 className="mt-6 mb-2 font-semibold">Eingeladen</h2>
      {list.isPending && (
        <div aria-busy="true" aria-label="Lädt">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="mb-2 h-14 animate-skeleton rounded-2xl border border-line bg-sunken"
            />
          ))}
        </div>
      )}
      {list.isError && (
        <div className={`${card} p-4`} role="alert">
          <p className="mb-3">Die Einladungen konnten nicht geladen werden.</p>
          <button type="button" className={quiet} onClick={() => void list.refetch()}>
            Nochmal versuchen
          </button>
        </div>
      )}
      {list.data?.length === 0 && (
        <p className="text-ink-muted">
          Noch niemand. Oben eine E-Mail-Adresse eintragen und einladen.
        </p>
      )}
      {list.data && list.data.length > 0 && (
        <ul className={`${card} divide-y divide-line`}>
          {list.data.map((inv) => (
            <li key={inv.email} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate">{inv.email}</div>
                <div className="text-xs text-ink-muted">
                  seit{" "}
                  {new Date(inv.invitedAt).toLocaleDateString("de-AT", {
                    timeZone: "Europe/Vienna",
                  })}
                </div>
              </div>
              {asking === inv.email ? (
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className={danger}
                    disabled={withdraw.isPending}
                    aria-busy={withdraw.isPending}
                    onClick={() => withdraw.mutate(inv.email)}
                  >
                    Zurücknehmen
                  </button>
                  <button type="button" className={quiet} onClick={() => setAsking(null)}>
                    Abbrechen
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`${link} shrink-0 text-sm`}
                  onClick={() => setAsking(inv.email)}
                >
                  Zurücknehmen …
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {withdraw.isError && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {errorText(withdraw.error)}
        </p>
      )}
    </main>
  );
}
