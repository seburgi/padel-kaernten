import { describe, expect, it, vi } from "vitest";
import { serve, problem } from "../test/fetch";
import { api, ApiError, call, isLocal, newKey, reloadOnce } from "./client";

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

  it("mints keys", () => {
    expect(newKey()).not.toBe(newKey());
  });
});
