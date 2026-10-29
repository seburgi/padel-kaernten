import { describe, expect, it, vi } from "vitest";
import { serve, problem } from "../test/fetch";
import { api, ApiError, call, isLocal, newKey, reloadOnce, send } from "./client";

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

  it("counts a second trip to sign-in as an expired note", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(toSignIn()));
    const res = await send(new Request("https://padel.test/x"), () => Promise.resolve());
    expect(res.status).toBe(401);
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
