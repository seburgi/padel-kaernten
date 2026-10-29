// The latest free courts (docs/design/slots.md). A schedule asks the
// booking sites every 30 minutes, so opening the app only reads; it asks
// by itself only when there is no snapshot or the schedule has missed
// (an hour old). Anyone may ask now with Aktualisieren, and the API asks
// the sites at most every five minutes whoever asks.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, call, newKey, type Snapshot } from "../api/client";
import { ageMinutes } from "./search";

/** How old a snapshot must be before Aktualisieren asks the sites again. */
export const STALE_MINUTES = 5;
/** How old a snapshot must be before opening the app asks by itself. */
export const MISSED_MINUTES = 60;

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

  // Asks once per opening or return to the app, and only when the schedule
  // left nothing fresh; a failed refresh waits for Try again
  // (standards/frontend/screen-states.md: nothing retries by itself).
  const asked = useRef(false);
  const [front, setFront] = useState(0);
  useEffect(() => {
    if (!loaded || asked.current) return;
    if (data && ageMinutes(data.takenAt) < MISSED_MINUTES) return;
    asked.current = true;
    mutate(newKey());
  }, [loaded, data, mutate, front]);

  // The clock Aktualisieren goes by: it can ask again once the snapshot is
  // five minutes old.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      asked.current = false;
      setNow(Date.now());
      setFront((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const takenAt = data ? new Date(data.takenAt).getTime() : null;
  return {
    snapshot: data ?? null,
    loading: query.isPending || (loaded && !data && isPending),
    loadFailed: query.isError,
    refreshing: isPending,
    refreshFailed: refresh.isError ? (refresh.error as ApiError | Error) : null,
    /** When Aktualisieren may ask again; null when it may now. */
    nextAt:
      takenAt !== null && now - takenAt < STALE_MINUTES * 60000
        ? new Date(takenAt + STALE_MINUTES * 60000)
        : null,
    refreshNow: () => mutate(newKey()),
    retry: () => {
      if (query.isError) void query.refetch();
      else mutate(newKey());
    },
  };
}
