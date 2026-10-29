// The agents' browser (ported from Billomatic): one headless Chromium per
// script, signed in through the local gateway (/dev-gateway/), with the
// checks every verification learned the hard way.
//
//   import { openApp } from '<checkout>/services/app/tools/browse.mjs'
//   const app = await openApp({ base: 'http://localhost:5173', out: '/tmp/browse', label: 'news' })
//   const desktop = await app.signIn()                      // 1280×900, Seb
//   const phone = await app.signIn({ phone: true })         // iPhone 13, pointer: coarse
//   const anna = await app.signIn({ who: 'Anna' })          // Seb, Anna, Markus or Lisa
//   await phone.go('/whats-new')                             // paced, url asserted
//   await phone.shot('whats-new')                            // → out/news-phone-whats-new.png
//   console.log(await phone.measure(() => getComputedStyle(document.querySelector('input')).fontSize))
//   await app.close()
import { chromium, devices } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A cloud container ships one Chromium at /opt/pw-browsers/chromium, built for
// an older Playwright than package.json pins, so the build Playwright looks for
// is missing there and launch() fails. BROWSE_CHROMIUM names a browser
// explicitly; otherwise the container's own is used when Playwright's is absent.
function chromiumPath() {
  if (process.env.BROWSE_CHROMIUM) return process.env.BROWSE_CHROMIUM;
  if (existsSync(chromium.executablePath())) return undefined;
  return existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
}

export async function openApp({ base, out, label, pace = 3000, headless = true }) {
  if (!base || !out)
    throw new Error("openApp needs base (http://localhost:5173) and out (screenshot folder)");
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless, executablePath: chromiumPath() });
  const prefix = label ? `${label}-` : "";
  let last = 0;
  const paced = async () => {
    const wait = last + pace - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };

  async function signIn({ who = "Seb", phone = false, theme } = {}) {
    const context = await browser.newContext(
      phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1280, height: 900 } },
    );
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("response", (r) => {
      if (r.status() === 429) errors.push(`429 ${r.url()}`);
    });
    await paced();
    // Signing in is one request: the API's local gateway (proxied by the app
    // dev server) sets its note in a cookie on this origin and redirects to
    // `next`. `who` is the name on its page: Seb, Anna, Markus or Lisa.
    await page.goto(
      `${base}/dev-gateway/sign-in?as=${encodeURIComponent(who.toLowerCase())}&next=/`,
      { waitUntil: "networkidle" },
    );
    // The courts keep their filter in the hash, so only the path is asserted;
    // someone in a group opens on Spielen instead.
    await page.waitForURL(
      (url) => url.origin === new URL(base).origin && ["/", "/play"].includes(url.pathname),
    );
    if (theme)
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    const kind = phone ? "phone" : "desktop";
    const cdp = phone ? await context.newCDPSession(page) : null;
    async function assertCoarse() {
      const isCoarse = () => page.evaluate(() => matchMedia("(pointer: coarse)").matches);
      if (await isCoarse()) return;
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [
          { name: "pointer", value: "coarse" },
          { name: "hover", value: "none" },
        ],
      });
      if (!(await isCoarse()))
        throw new Error(
          "phone context lost pointer: coarse and it could not be restored; reload the page before measuring",
        );
    }

    const session = {
      page,
      context,
      errors,
      kind,
      who,
      async go(path, { assertBase = true } = {}) {
        await paced();
        await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
        if (assertBase && !page.url().startsWith(base))
          throw new Error(`landed on ${page.url()}, not ${base}: a server moved port`);
        if (phone) await assertCoarse();
        return page;
      },
      async shot(name, opts = {}) {
        const path = `${out}/${prefix}${kind}-${name}.png`;
        // A full-page capture resizes the viewport and drops Chromium's pointer
        // emulation, so every touch target measured afterwards read fine-pointer
        // sizes (Billomatic, 2026-09-13). A phone context
        // captures the viewport unless asked otherwise, and either way the coarse
        // pointer is re-asserted and checked before the next measurement.
        await page.screenshot({ path, fullPage: !phone, ...opts });
        if (phone) await assertCoarse();
        return path;
      },
      measure: async (fn, arg) => {
        if (phone) await assertCoarse();
        return page.evaluate(fn, arg);
      },
      // A locator's click() scrolls its target into view before it presses, and
      // that scroll is the harness's, not the person's. tap() presses at the element's coordinates as they are and refuses an
      // element that is off screen, so any scroll seen in a measurement of
      // scroll or focus was written by the app or by the script on purpose.
      async tap(target) {
        const locator = typeof target === "string" ? page.locator(target) : target;
        const box = await locator.boundingBox({ timeout: 5000 });
        if (!box) throw new Error("tap: the element is not rendered");
        const vp = page.viewportSize();
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        if (x < 0 || y < 0 || x > vp.width || y > vp.height) {
          throw new Error(
            `tap: the element's centre (${Math.round(x)},${Math.round(y)}) is outside the ${vp.width}×${vp.height} viewport; scroll the way a person would (page.mouse.wheel, or a touch drag) and tap again`,
          );
        }
        if (phone) await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
        if (phone) await assertCoarse();
      },
      noOverflow: async () =>
        page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        })),
    };
    return session;
  }

  return { browser, signIn, close: () => browser.close() };
}

export { devices };
