import { describe, expect, it, vi } from "vitest";
import { serve, problem } from "../test/fetch";
import { api, ApiError, call, isLocal, newKey, reloadOnce, send, SIGN_IN_WAITS_MS } from "./client";

describe("client", () => {
  it("reloads once for an expired note", () => {
    const reload = vi.fn();
    expect(reloadOnce(sessionStorage, reload)).toBe(true);
    expect(reloadOnce(sessionStorage, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("sends a laptop to the local sign-in, and back", () => {
    history.replaceState(null, "", "/whats-new?x=1");
    const go = vi.fn();
    const reload = vi.fn();
    expect(reloadOnce(sessionStorage, reload, true, go)).toBe(true);
    expect(go).toHaveBeenCalledWith("/dev-gateway/?next=%2Fwhats-new%3Fx%3D1");
    expect(reload).not.toHaveBeenCalled();
    expect(isLocal("localhost")).toBe(true);
    expect(isLocal("padel.burgstaller.me")).toBe(false);
  });

  it("turns problems and lost connections into ApiError", async () => {
    serve({ "GET /api/v1/me": () => problem(401, "not-signed-in") });
    await expect(call(api.GET("/api/v1/me"))).rejects.toMatchObject({
      status: 401,
      kind: "not-signed-in",
    });
    expect(sessionStorage.getItem("padel.reloaded-for-401")).toBe("1");
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
    await expect(call(api.GET("/api/v1/me"))).rejects.toEqual(new ApiError(0, "network"));
  });

  // What fetch hands back for a redirect it did not follow.
  const toSignIn = () => ({ type: "opaqueredirect", status: 0, ok: false }) as Response;

  it("never follows the gateway to sign-in, and asks once more", async () => {
    const seen: RequestRedirect[] = [];
    const fake = vi
      .fn()
      .mockImplementationOnce((req: Request) => (seen.push(req.redirect), toSignIn()))
      .mockImplementationOnce(async (req: Request) => {
        seen.push(req.redirect);
        return new Response(await req.text(), { status: 200 });
      });
    vi.stubGlobal("fetch", fake);
    const wait = vi.fn(() => Promise.resolve());
    const res = await send(
      new Request("https://padel.test/x", { method: "POST", body: "b" }),
      wait,
    );
    expect(await res.text()).toBe("b");
    expect(seen).toEqual(["manual", "manual"]);
    expect(wait).toHaveBeenCalledWith(1500);
  });

  it("waits about ten seconds for a waking gateway, then counts it as an expired note", async () => {
    const fake = vi.fn(() => Promise.resolve(toSignIn()));
    vi.stubGlobal("fetch", fake);
    const wait = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
    const res = await send(
      new Request("https://padel.test/x", { method: "POST", body: "b" }),
      wait,
    );
    expect(res.status).toBe(401);
    expect(fake).toHaveBeenCalledTimes(1 + SIGN_IN_WAITS_MS.length);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual(SIGN_IN_WAITS_MS);
    expect(SIGN_IN_WAITS_MS.reduce((a, b) => a + b)).toBe(10_000);
  });

  it("asks only once when the answer is no redirect", async () => {
    const fake = vi.fn(() => Promise.resolve(new Response(null, { status: 500 })));
    vi.stubGlobal("fetch", fake);
    expect((await send(new Request("https://padel.test/x"))).status).toBe(500);
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it("mints keys", () => {
    expect(newKey()).not.toBe(newKey());
  });
});
