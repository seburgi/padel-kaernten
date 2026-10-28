// What the group screens share (docs/design/groups.md): the calls, and what
// each problem means in German.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, call, useWriteKey } from "../api/client";

export const KINDS: { kind: string; label: string; hint: string }[] = [
  { kind: "private", label: "Privat", hint: "Nur wer eingeladen ist, sieht die Gruppe." },
  { kind: "on_request", label: "Auf Anfrage", hint: "Alle sehen sie, ihr lasst Leute herein." },
  { kind: "open", label: "Offen", hint: "Alle sehen sie und können beitreten." },
];

export const kindLabel = (kind: string) => KINDS.find((k) => k.kind === kind)?.label ?? kind;

/** Where the group plays, when it is not everywhere; set at "Wann passt es für vier?". */
export const areaLabel = (area: string) =>
  ({ halle: "Nur Halle", freiluft: "Nur Freiluft" })[area] ?? "";

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.kind) {
      case "invalid-email":
        return "Das ist keine E-Mail-Adresse. Schreib eine wie name@example.at.";
      case "invalid-group":
        return "Ein Name hat 1 bis 40 Zeichen.";
      case "invalid-name":
        return "Ein Name hat 1 bis 40 Zeichen.";
      case "already-member":
        return "Die Person ist schon in der Gruppe.";
      case "invite-limit":
        return "Du hast gerade sehr viele eingeladen: höchstens 20 offene Einladungen und 10 neue am Tag.";
      case "platform-failed":
        return "Die Anmeldung hat nicht geantwortet. Es wurde nichts geändert, versuch es nochmal.";
      case "not-allowed":
        return "Das dürfen nur die Admins der Gruppe.";
      case "no-group":
        return "Diese Gruppe gibt es nicht mehr.";
    }
  }
  return "Das hat nicht geklappt. Versuch es nochmal.";
}

/** Who is looking: the same question the head asks. */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => call(api.GET("/api/v1/me")),
    retry: false,
  });
}

export function useGroups() {
  return useQuery({
    queryKey: ["groups"],
    queryFn: async () => (await call(api.GET("/api/v1/groups"))).items,
    retry: false,
  });
}

/** Joining: accepts an invitation, joins an open group, or asks in. */
export function useJoin(after?: (id: number, state: string) => void) {
  const client = useQueryClient();
  const key = useWriteKey();
  return useMutation({
    mutationFn: async (id: number) => ({
      id,
      ...(await call(
        api.POST("/api/v1/groups/{groupId}/join", {
          params: { path: { groupId: id }, header: { "Idempotency-Key": key(id) } },
        }),
      )),
    }),
    onSuccess: ({ id, state }) => {
      void client.invalidateQueries({ queryKey: ["groups"] });
      void client.invalidateQueries({ queryKey: ["group", id] });
      after?.(id, state);
    },
  });
}

/** Declining an invitation, or taking one back. */
export function useDropInvitation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, email }: { id: number; email: string }) =>
      call(
        api.DELETE("/api/v1/groups/{groupId}/invitations/{email}", {
          params: { path: { groupId: id, email } },
        }),
      ),
    onSuccess: (_, { id }) => {
      void client.invalidateQueries({ queryKey: ["groups"] });
      void client.invalidateQueries({ queryKey: ["group", id] });
    },
  });
}
