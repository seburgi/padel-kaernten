/// <reference lib="webworker" />
import { serveShell } from "@burgstaller/web/sw";
import { notificationOf } from "./push/notification";

serveShell({ app: "padel" });

declare const self: ServiceWorkerGlobalScope;

// Mitteilungen (docs/design/notify.md): show what the API pushed, and open
// the game on a tap, in a window of the app that is already open if any.
self.addEventListener("push", (event) => {
  let data: unknown;
  try {
    data = event.data?.json();
  } catch {
    // Not JSON: the defaults.
  }
  const { title, options } = notificationOf(data);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data as { url?: string } | null)?.url ?? "/play",
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows[0];
      if (open) return open.navigate(url).then((w) => (w ?? open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
