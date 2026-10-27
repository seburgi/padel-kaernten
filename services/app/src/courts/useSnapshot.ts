// The latest free courts, and a refresh when they are five minutes old:
// on opening the app and on coming back to it (docs/design/slots.md). The
// API asks the booking sites at most every five minutes whoever asks.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, call, newKey, type Snapshot } from "../api/client";
import { ageMinutes } from "./search";

export const STALE_MINUTES = 5;

async function latest(): Promise<Snapshot | null> {
  try {
    return await call(api.GET("/api/v1/slots"));
  } catch (e) {
    if (e instanceof ApiError && e.kind === "no-snapshot") return null;
    throw e;
  }
}

export function useSnapshot() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["slots"], queryFn: latest, retry: false });
  const refresh = useMutation({
    mutationFn: (key: string) =>
      call(api.POST("/api/v1/slots/refresh", { params: { header: { "Idempotency-Key": key } } })),
    onSuccess: (snap) => client.setQueryData(["slots"], snap),
  });

  const { mutate, isPending } = refresh;
  const data = query.data;
  const loaded = query.isSuccess;

  // Asks once per opening or return to the app; a failed refresh waits for
  // Try again (standards/frontend/screen-states.md: nothing retries by itself).
  const asked = useRef(false);
  const [front, setFront] = useState(0);
  useEffect(() => {
    if (!loaded || asked.current) return;
    if (data && ageMinutes(data.takenAt) < STALE_MINUTES) return;
    asked.current = true;
    mutate(newKey());
  }, [loaded, data, mutate, front]);

  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      asked.current = false;
      setFront((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return {
    snapshot: data ?? null,
    loading: query.isPending || (loaded && !data && isPending),
    loadFailed: query.isError,
    refreshing: isPending,
    refreshFailed: refresh.isError ? (refresh.error as ApiError | Error) : null,
    retry: () => {
      if (query.isError) void query.refetch();
      else mutate(newKey());
    },
  };
}
