// Mitteilungen (docs/design/notify.md): this browser's Web Push
// subscription, kept by the API for the person signed in. The API names a
// subscription by its endpoint's hash, so nothing is kept here.
import { ios, standalone } from "@burgstaller/web/pwa";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, call, newKey } from "../api/client";

/** What this browser can do: on (subscribed), off (could be), blocked
 * (the person said no), home (iPhone: only from the home screen), none. */
export type Can = "on" | "off" | "blocked" | "home" | "none";

type Env = {
  sw?: ServiceWorkerContainer;
  permission?: NotificationPermission;
  hasPush: boolean;
  iphone: boolean;
  home: boolean;
};

export function env(): Env {
  return {
    sw: "serviceWorker" in navigator ? navigator.serviceWorker : undefined,
    permission: typeof Notification === "function" ? Notification.permission : undefined,
    hasPush: typeof PushManager === "function",
    iphone: ios(),
    home: standalone(),
  };
}

/** Where this browser stands; sub is its current subscription. */
export function canOf(e: Env, sub: PushSubscription | null): Can {
  if (!e.sw || !e.hasPush || e.permission === undefined)
    return e.iphone && !e.home ? "home" : "none";
  if (e.permission === "denied") return "blocked";
  return sub && e.permission === "granted" ? "on" : "off";
}

/** The first 32 hex digits of the endpoint's SHA-256, as the API names it. */
export async function idOf(endpoint: string): Promise<string> {
  const sum = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(sum).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** base64url to bytes, for applicationServerKey. */
export function bytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function current(e: Env): Promise<PushSubscription | null> {
  if (!e.sw || !e.hasPush) return null;
  // ready never settles without a worker (a laptop); this does.
  const reg = await e.sw.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Tells the API about sub (again). */
export async function keep(sub: PushSubscription) {
  const json = sub.toJSON();
  await call(
    api.PUT("/api/v1/push/subscriptions/{subscriptionId}", {
      params: {
        path: { subscriptionId: await idOf(sub.endpoint) },
        header: { "Idempotency-Key": newKey() },
      },
      body: {
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
      },
    }),
  );
}

/** Asks the person, subscribes, tells the API. False when they did not
 * allow it (a no shows as blocked once the card asks again). */
export async function turnOn(publicKey: string, e: Env = env()): Promise<boolean> {
  const answer = await Notification.requestPermission();
  if (answer !== "granted" || !e.sw) return false;
  const reg = await e.sw.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: bytes(publicKey),
  });
  try {
    await keep(sub);
  } catch (e) {
    // Subscribed in the browser but unknown to the API would show as on.
    await sub.unsubscribe();
    throw e;
  }
  return true;
}

/** Forgets this browser, at the API and in the browser. */
export async function turnOff(e: Env = env()) {
  const sub = await current(e);
  if (!sub) return;
  await call(
    api.DELETE("/api/v1/push/subscriptions/{subscriptionId}", {
      params: { path: { subscriptionId: await idOf(sub.endpoint) } },
    }),
  );
  await sub.unsubscribe();
}

/** The API's key (none when push is off) and where this browser stands. */
export function usePush() {
  return useQuery({
    queryKey: ["push"],
    queryFn: async () => {
      const [info, sub] = await Promise.all([call(api.GET("/api/v1/push")), current(env())]);
      return { publicKey: info.publicKey, can: canOf(env(), sub), sub };
    },
    retry: false,
    staleTime: Infinity,
  });
}

/** Once per opening: a subscribed browser is sent again, so the API knows
 * it is still in use and has its keys as they are now. */
export function useKeepPush() {
  const push = usePush();
  const client = useQueryClient();
  const sub = push.data?.publicKey ? push.data.sub : null;
  useEffect(() => {
    if (sub) keep(sub).catch(() => void client.invalidateQueries({ queryKey: ["push"] }));
  }, [sub, client]);
}
