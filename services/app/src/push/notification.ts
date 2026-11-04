// What the service worker shows for a push (src/sw.ts), and the answer
// a button on it gives (Bin dabei, Kann nicht; Seb 2026-11-04). Apart from
// push.ts, so the worker takes nothing of the app with it.
/** The notification for a push's data: its title, text, tag and the path
 * a tap opens; anything missing has a default. */
export function notificationOf(data: unknown): {
  title: string;
  options: NotificationOptions & { actions?: { action: string; title: string }[] };
} {
  const d = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  const text = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  const url = text("url").startsWith("/") ? text("url") : "/play";
  // A proposed game can be answered from the notification itself, where
  // the browser shows buttons (not on an iPhone: there a tap opens it).
  const game = Number.isSafeInteger(d.game) && (d.game as number) > 0 ? (d.game as number) : 0;
  return {
    title: text("title") || "Padel Kärnten",
    options: {
      body: text("body"),
      tag: text("tag") || undefined,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: game ? { url, game } : { url },
      ...(game && {
        actions: [
          { action: "in", title: "Bin dabei" },
          { action: "out", title: "Kann nicht" },
        ],
      }),
    },
  };
}

/** The answer a button on a notification gives, or null for a tap. */
export function answerOf(
  action: string,
  data: unknown,
): { game: number; answer: "in" | "out" } | null {
  const game = (data as { game?: unknown } | null)?.game;
  if ((action !== "in" && action !== "out") || !Number.isSafeInteger(game) || (game as number) <= 0)
    return null;
  return { game: game as number, answer: action };
}

/** Answers the game for whoever is signed in, as the app would. False when
 * it did not take (signed out, the game closed): then the game opens. */
export async function sendAnswer(
  a: { game: number; answer: "in" | "out" },
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetcher(`/api/v1/games/${a.game}/players/me`, {
      method: "PUT",
      credentials: "same-origin",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
        "X-Client": "web/notification",
      },
      body: JSON.stringify({ answer: a.answer }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** What the notification says once the answer took. */
export function answeredOf(a: { game: number; answer: "in" | "out" }): {
  title: string;
  options: NotificationOptions;
} {
  return {
    title: a.answer === "in" ? "Du bist dabei" : "Du hast abgesagt",
    options: {
      body: "Tippen, um das Spiel zu öffnen.",
      tag: `game-${a.game}`,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: `/games/${a.game}` },
    },
  };
}
