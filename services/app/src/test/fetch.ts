// A stand-in for the API: answers by "METHOD path" and keeps what was sent.
// openapi-fetch hands fetch a Request.
import { vi } from "vitest";

export type Sent = { method: string; url: URL; headers: Headers; body: unknown };
export type Answer = (sent: Sent) => Response | Promise<Response>;

export const answer = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": status >= 400 ? "application/problem+json" : "application/json" },
  });

export const problem = (status: number, kind: string) =>
  answer(status, { type: `https://padel.burgstaller.me/problems/${kind}`, title: kind, status });

export function serve(routes: Record<string, Answer>, calls: Sent[] = []) {
  const fake = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const req =
      input instanceof Request
        ? input
        : new Request(new URL(String(input), "https://padel.test"), init);
    const url = new URL(req.url);
    const text = await req.text();
    const sent: Sent = {
      method: req.method,
      url,
      headers: req.headers,
      body: text ? JSON.parse(text) : undefined,
    };
    calls.push(sent);
    const route = routes[`${req.method} ${decodeURIComponent(url.pathname)}`];
    if (!route) return problem(404, "not-found");
    return route(sent);
  });
  vi.stubGlobal("fetch", fake);
  return calls;
}
