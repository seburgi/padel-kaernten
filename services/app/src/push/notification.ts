// What the service worker shows for a push (src/sw.ts). Apart from
// push.ts, so the worker takes nothing of the app with it.
/** The notification for a push's data: its title, text, tag and the path
 * a tap opens; anything missing has a default. */
export function notificationOf(data: unknown): {
  title: string;
  options: NotificationOptions;
} {
  const d = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  const text = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  const url = text("url").startsWith("/") ? text("url") : "/play";
  return {
    title: text("title") || "Padel Kärnten",
    options: {
      body: text("body"),
      tag: text("tag") || undefined,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url },
    },
  };
}
