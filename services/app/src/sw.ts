/// <reference lib="webworker" />
import { serveShell } from "@burgstaller/web/sw";
import { answeredOf, answerOf, notificationOf, sendAnswer } from "./push/notification";

serveShell({ app: "padel" });

declare const self: ServiceWorkerGlobalScope;

// Mitteilungen (docs/design/notify.md): show what the API pushed, and open
// the game on a tap, in a window of the app that is already open if any.
// Bin dabei and Kann nicht on a proposed game answer it from here; when
// that does not take, the game opens instead.
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

function openApp(path: string) {
  const url = new URL(path, self.location.origin).href;
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const open = windows[0];
    if (open) return open.navigate(url).then((w) => (w ?? open).focus());
    return self.clients.openWindow(url);
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | null;
  const path = data?.url ?? "/play";
  const answer = answerOf(event.action, data);
  if (!answer) {
    event.waitUntil(openApp(path));
    return;
  }
  event.waitUntil(
    sendAnswer(answer).then(async (took) => {
      if (!took) {
        await openApp(path);
        return;
      }
      const { title, options } = answeredOf(answer);
      await self.registration.showNotification(title, options);
    }),
  );
});
