// The typed client for api/openapi.yaml (standards/api/contract.md). Every
// call says which build sent it (X-Client); writes carry an Idempotency-Key
// the caller mints once, so a retry reuses it (standards/api/idempotency.md).
import createClient, { type Middleware } from "openapi-fetch";
import { useRef } from "react";
import type { components, paths } from "./schema";

export type Snapshot = components["schemas"]["Snapshot"];
export type Venue = components["schemas"]["Venue"];
export type Court = components["schemas"]["Court"];
export type Slot = components["schemas"]["Slot"];
export type Invitation = components["schemas"]["Invitation"];
export type InvitationPage = components["schemas"]["InvitationPage"];
export type Me = components["schemas"]["Me"];
export type Problem = components["schemas"]["Problem"];
export type GroupSummary = components["schemas"]["GroupSummary"];
export type Group = components["schemas"]["Group"];
export type Span = components["schemas"]["Span"];
export type Availability = components["schemas"]["Availability"];
export type Template = components["schemas"]["Template"];
export type Fit = components["schemas"]["Fit"];
export type FitList = components["schemas"]["FitList"];
export type Game = components["schemas"]["Game"];

/** An answer that was not what the call wanted; kind is the end of the
 * problem's type URI ("sites-failed"), or "network". */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly kind: string,
  ) {
    super(`${status} ${kind}`);
  }
}

const RELOADED = "padel.reloaded-for-401";

/** A laptop, where the API's stand-in at /dev-gateway/ signs people in.
 * Deployed, the app is only ever served behind the gateway. */
export function isLocal(hostname: string = location.hostname): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** A 401 means the gateway's note expired: reload once so the gateway signs
 * the person in again (standards/auth/checking-the-note.md). On a laptop the
 * local sign-in page asks who, and comes back. */
export function reloadOnce(
  store: Storage = sessionStorage,
  reload = () => location.reload(),
  local = isLocal(),
  go = (to: string) => location.assign(to),
) {
  if (local) {
    go(`/dev-gateway/?next=${encodeURIComponent(location.pathname + location.search)}`);
    return true;
  }
  if (store.getItem(RELOADED)) return false;
  store.setItem(RELOADED, "1");
  reload();
  return true;
}

const clientHeader: Middleware = {
  onRequest({ request }) {
    request.headers.set("X-Client", `web/${import.meta.env.VITE_COMMIT ?? "dev"}`);
    return request;
  },
  onResponse({ response }) {
    if (response.status === 401) reloadOnce();
    else if (response.ok) sessionStorage.removeItem(RELOADED);
    return response;
  },
};

// The address is absolute (a Request needs one outside the browser), and
// fetch is looked up on each call, so tests can stand in for it.
export const api = createClient<paths>({
  baseUrl: location.origin,
  fetch: (req) => globalThis.fetch(req),
});
api.use(clientHeader);

/** The answer's data, or an ApiError. */
export async function call<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await request;
  } catch {
    throw new ApiError(0, "network");
  }
  const { data, error, response } = result;
  if (error !== undefined || !response.ok) {
    const type = (error as Partial<Problem> | undefined)?.type ?? "";
    throw new ApiError(response.status, type.slice(type.lastIndexOf("/") + 1) || "unknown");
  }
  return data as T;
}

/** A fresh key for one write; keep it for the write's retries. */
export function newKey(): string {
  return crypto.randomUUID();
}

/** A key per write: the same while what is written stays the same, so a
 * retry after a failure reuses it, and fresh for anything else. */
export function useWriteKey(): (body: unknown) => string {
  const last = useRef<{ body: string; key: string } | null>(null);
  return (body) => {
    const text = JSON.stringify(body);
    if (last.current?.body !== text) last.current = { body: text, key: newKey() };
    return last.current.key;
  };
}
