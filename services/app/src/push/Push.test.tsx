import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { answer, problem, serve, type Sent } from "../test/fetch";
import { renderWithQuery } from "../test/render";
import { notificationOf } from "./notification";
import { bytes, canOf, idOf, useKeepPush } from "./push";
import { PushCard } from "./PushCard";

const KEY = "BAEC"; // three bytes are enough for the browser stand-in

type Sub = {
  endpoint: string;
  toJSON: () => { keys: { p256dh: string; auth: string } };
  unsubscribe: ReturnType<typeof vi.fn>;
};

function subOf(endpoint = "https://push.example/1"): Sub {
  return {
    endpoint,
    toJSON: () => ({ keys: { p256dh: "pk", auth: "au" } }),
    unsubscribe: vi.fn(async () => true),
  };
}

/** A browser with a service worker and push: permission as given, a
 * subscription or none, and what requestPermission will answer. */
function browser({
  permission = "default" as NotificationPermission,
  sub = null as Sub | null,
  asked = "granted" as NotificationPermission,
} = {}) {
  const state = { sub, permission };
  const subscribe = vi.fn(async (_options: PushSubscriptionOptionsInit) => {
    const sub = subOf();
    sub.unsubscribe.mockImplementation(async () => {
      state.sub = null;
      return true;
    });
    state.sub = sub;
    return sub;
  });
  const reg = {
    pushManager: { getSubscription: async () => state.sub, subscribe },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    value: { ready: Promise.resolve(reg), getRegistration: async () => reg },
    configurable: true,
  });
  const N = Object.assign(function () {}, {
    requestPermission: vi.fn(async () => {
      state.permission = asked;
      return asked;
    }),
  });
  Object.defineProperty(N, "permission", { get: () => state.permission });
  vi.stubGlobal("Notification", N);
  vi.stubGlobal("PushManager", function () {});
  return { state, subscribe, N };
}

afterEach(() => {
  delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  Object.defineProperty(navigator, "userAgent", { value: "jsdom", configurable: true });
});

function api(publicKey: string | undefined = KEY, put = () => answer(204)) {
  const calls: Sent[] = [];
  serve(
    {
      "GET /api/v1/push": () => answer(200, publicKey ? { publicKey } : {}),
      [`PUT /api/v1/push/subscriptions/${ID}`]: put,
      [`DELETE /api/v1/push/subscriptions/${ID}`]: () => answer(204),
    },
    calls,
  );
  return calls;
}

// The API's name for the stand-in's subscription.
const ID = await idOf("https://push.example/1");

describe("the helpers", () => {
  it("names a subscription as the API does", async () => {
    expect(await idOf("abc")).toBe("ba7816bf8f01cfea414140de5dae2223");
    expect(ID).toMatch(/^[0-9a-f]{32}$/);
  });

  it("reads base64url keys", () => {
    expect(Array.from(bytes("BAEC"))).toEqual([4, 1, 2]);
    expect(Array.from(bytes("-_8"))).toEqual([251, 255]);
  });

  it("knows where a browser stands", () => {
    const sw = {} as ServiceWorkerContainer;
    const base = { sw, permission: "default" as const, hasPush: true, iphone: false, home: false };
    expect(canOf(base, null)).toBe("off");
    expect(canOf({ ...base, permission: "granted" }, {} as PushSubscription)).toBe("on");
    expect(canOf({ ...base, permission: "granted" }, null)).toBe("off");
    expect(canOf({ ...base, permission: "denied" }, null)).toBe("blocked");
    expect(canOf({ ...base, hasPush: false }, null)).toBe("none");
    expect(canOf({ ...base, sw: undefined, iphone: true }, null)).toBe("home");
    expect(canOf({ ...base, permission: undefined, iphone: true, home: true }, null)).toBe("none");
  });

  it("shows a push, or the defaults", () => {
    expect(
      notificationOf({ title: "Gebucht", body: "Villach", url: "/games/7", tag: "game-7" }),
    ).toEqual({
      title: "Gebucht",
      options: {
        body: "Villach",
        tag: "game-7",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { url: "/games/7" },
      },
    });
    const empty = notificationOf(null);
    expect(empty.title).toBe("Padel Kärnten");
    expect(empty.options.data).toEqual({ url: "/play" });
    expect(empty.options.tag).toBeUndefined();
    expect(notificationOf({ url: "https://elsewhere.example/", title: 3 }).options.data).toEqual({
      url: "/play",
    });
  });
});

describe("PushCard", () => {
  it("turns Mitteilungen on and off again", async () => {
    const b = browser();
    const calls = api();
    renderWithQuery(<PushCard where="play" />);
    await userEvent.click(await screen.findByRole("button", { name: "Mitteilungen einschalten" }));
    expect(await screen.findByText(/Mitteilungen sind an/)).toBeInTheDocument();
    expect(b.N.requestPermission).toHaveBeenCalled();
    const options = b.subscribe.mock.calls[0]![0];
    expect(Array.from(options.applicationServerKey as Uint8Array)).toEqual([4, 1, 2]);
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toEqual({
      endpoint: "https://push.example/1",
      keys: { p256dh: "pk", auth: "au" },
    });
    expect(put.headers.get("Idempotency-Key")).toBeTruthy();

    const sub = b.state.sub!;
    await userEvent.click(screen.getByRole("button", { name: "Ausschalten" }));
    await waitFor(() => expect(sub.unsubscribe).toHaveBeenCalled());
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("says so when the person says no, or the API fails", async () => {
    // Closed the browser's question without an answer.
    browser({ asked: "default" });
    api();
    let view = renderWithQuery(<PushCard where="play" />);
    await userEvent.click(await screen.findByRole("button", { name: "Mitteilungen einschalten" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ohne deine Erlaubnis");
    view.unmount();

    // A no: blocked from then on.
    browser({ asked: "denied" });
    api();
    view = renderWithQuery(<PushCard where="play" />);
    await userEvent.click(await screen.findByRole("button", { name: "Mitteilungen einschalten" }));
    expect(await screen.findByText(/blockiert/)).toBeInTheDocument();
    view.unmount();

    const b = browser();
    api(KEY, () => problem(500, "internal"));
    renderWithQuery(<PushCard where="game" />);
    expect(await screen.findByText("Erfahren, wer zusagt?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mitteilungen einschalten" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
    expect(b.state.sub).toBeNull();
  });

  it("is quiet where it has nothing to offer", async () => {
    browser({ permission: "granted", sub: subOf() });
    api();
    let view = renderWithQuery(<PushCard where="game" />);
    await waitFor(() => expect(document.body.textContent).toBe(""));
    view.unmount();

    browser({ permission: "denied" });
    api();
    view = renderWithQuery(<PushCard where="play" />);
    expect(await screen.findByText(/blockiert/)).toBeInTheDocument();
    view.unmount();
    view = renderWithQuery(<PushCard where="game" />);
    await waitFor(() => expect(screen.queryByText(/blockiert/)).toBeNull());
    view.unmount();

    // Push off at the API.
    browser();
    api(undefined);
    view = renderWithQuery(<PushCard where="play" />);
    await waitFor(() => expect(screen.queryByText("Mitteilungen")).toBeNull());
    view.unmount();

    // A browser without push.
    vi.stubGlobal("Notification", undefined);
    api();
    view = renderWithQuery(<PushCard where="play" />);
    await waitFor(() => expect(screen.queryByText("Mitteilungen")).toBeNull());
    view.unmount();
  });

  it("tells an iPhone in Safari to use the home screen", async () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      configurable: true,
    });
    api();
    renderWithQuery(<PushCard where="play" />);
    expect(await screen.findByText(/Home-Bildschirm/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

function Keeper() {
  useKeepPush();
  return <p>da</p>;
}

describe("useKeepPush", () => {
  it("sends a subscribed browser again on opening", async () => {
    browser({ permission: "granted", sub: subOf() });
    const calls = api();
    renderWithQuery(<Keeper />);
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1));
  });

  it("asks again when the API refuses it", async () => {
    browser({ permission: "granted", sub: subOf() });
    const calls = api(KEY, () => problem(409, "push-off"));
    renderWithQuery(<Keeper />);
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThanOrEqual(2),
    );
  });

  it("sends nothing without a subscription", async () => {
    browser();
    const calls = api();
    renderWithQuery(<Keeper />);
    await waitFor(() => expect(calls.some((c) => c.method === "GET")).toBe(true));
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });
});
