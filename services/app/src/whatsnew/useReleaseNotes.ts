// The notes the API serves, what of them is unread, and marking them read.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api, call, newKey } from "../api/client";
import type { ReleaseNote } from "./notes";

const key = ["release-notes"] as const;

export function useReleaseNoteList() {
  return useQuery({
    queryKey: key,
    queryFn: async () => (await call(api.GET("/api/v1/release-notes"))).items,
    retry: false,
  });
}

export function useReleaseNotes() {
  const client = useQueryClient();
  const { data: notes } = useReleaseNoteList();
  const unread = (notes ?? []).filter((note) => !note.read);

  const markRead = useCallback(async () => {
    const slugs = (client.getQueryData<ReleaseNote[]>(key) ?? [])
      .filter((note) => !note.read)
      .map((note) => note.slug);
    if (slugs.length === 0) return;
    // At once: the card goes on the tap, not on the round trip.
    client.setQueryData<ReleaseNote[]>(key, (all) => all?.map((note) => ({ ...note, read: true })));
    try {
      await call(
        api.POST("/api/v1/release-notes/read", {
          params: { header: { "Idempotency-Key": newKey() } },
          body: { slugs },
        }),
      );
    } catch {
      // Nobody needs to hear about it: the card stays away for this visit
      // and comes back on the next load.
    }
  }, [client]);

  return { unread, markRead };
}
