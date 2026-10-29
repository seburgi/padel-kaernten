// The Hilfe's pictures (docs/design/help.md): every screen it shows, on a
// phone, light and dark, from a fixed starting point, so they can be made
// again in a minute whenever a screen changes and never show real people.
//
// Needs the local API on a database of its own (ENVIRONMENT=local, which
// this script empties) and the app's dev server:
//
//   cd services/api && ENVIRONMENT=local DATABASE_URL=postgres://… APP_DIST= go run ./cmd/api
//   cd services/app && pnpm dev
//   cd services/app && DATABASE_URL=postgres://… node tools/help-shots.mjs
//
// It writes public/help/<name>.webp and <name>-dark.webp, which the Hilfe
// names in src/help/chapters.tsx, and their sizes to src/help/shots.json.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openApp } from "./browse.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "../public/help");
const BASE = process.env.BASE ?? "http://localhost:5173";
const API = process.env.API ?? "http://localhost:8080";
const DB = process.env.DATABASE_URL;
// What the pictures are scaled to: twice a phone's width, sharp enough on
// every screen and a fraction of the size of the phone's own three times.
const WIDTH = 780;

if (!DB) throw new Error("help-shots needs DATABASE_URL, the local API's database");
const host = new URL(DB.replace(/^postgres(ql)?:/, "http:")).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host))
  throw new Error(`help-shots empties its database; ${host} is not this machine`);

const sql = (text) =>
  execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-qAt"], { input: text }).toString();

// --- The starting point ------------------------------------------------------

const vienna = (d) => d.toLocaleDateString("en-CA", { timeZone: "Europe/Vienna" });
const DAYS = Array.from({ length: 14 }, (_, i) => vienna(new Date(Date.now() + i * 864e5)));

/** A fixed snapshot: every venue in venues.json with the same free times,
 * so the pictures do not depend on what the booking sites say today. */
function snapshot() {
  const venues = JSON.parse(
    readFileSync(join(here, "../../api/internal/slots/sites/venues.json"), "utf8"),
  );
  const list = Array.isArray(venues) ? venues : venues.venues;
  const place = (address = "") => address.replace(/^.*\d{4}\s+/, "");
  return {
    // Ten minutes old: Plätze shows Aktualisieren, and nothing asks the
    // sites by itself before an hour.
    takenAt: new Date(Date.now() - 10 * 60000).toISOString(),
    days: DAYS,
    venues: list.map((v, n) => {
      // The venue's own kind of court, as venues.json says; the others
      // (Eversports, Padelmates) are open-air ones (booking-sites.md).
      const area = v.area ?? "freiluft";
      const indoor = area === "halle";
      const price = { amount: indoor ? 4800 : 3600, currency: "EUR" };
      return {
        id: v.id,
        name: v.name,
        place: place(v.address),
        address: v.address,
        platform: v.platform,
        failed: false,
        notBookable: v.platform === "padelmates" ? DAYS.slice(8) : [],
        step: 30,
        links: Object.fromEntries(DAYS.map((d) => [d, `https://example.at/${v.id}?day=${d}`])),
        courts: [1, 2].map((c) => ({
          name: `Platz ${c}`,
          area,
          // Each court free in two stretches a day, shifted per venue and
          // court so the list does not look copied.
          free: DAYS.flatMap((day, i) => {
            const shift = ((n + c + i) % 4) * 30;
            return [
              { day, from: 8 * 60 + shift, to: 11 * 60 + shift, pricePerHour: price },
              { day, from: 17 * 60 + shift, to: 21 * 60 + shift, pricePerHour: price },
            ].filter((s) => (n + c + i) % 5 !== 0 || s.from > 12 * 60);
          }),
        })),
      };
    }),
  };
}

function writeSnapshot() {
  const s = snapshot();
  sql(
    `INSERT INTO snapshot (id, data, taken_at) VALUES (1, $snap$${JSON.stringify(s)}$snap$, '${s.takenAt}')
     ON CONFLICT (id) DO UPDATE SET data = excluded.data, taken_at = excluded.taken_at;`,
  );
}

const tokens = {};
async function as(who, method, path, body) {
  tokens[who] ??= (await (await fetch(`${API}/dev-gateway/token?as=${who}`)).text()).trim();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${tokens[who]}`,
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${who} ${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const NAMES = { seb: "Seb", anna: "Anna", markus: "Markus", lisa: "Lisa" };
const EMAIL = (who) => `${who}@local.test`;

async function seed() {
  sql(`TRUNCATE people, invitations, idempotency_keys, release_note_reads, groups, memberships,
       group_invitations, join_requests, availability_spans, availability_declined, availability_templates,
       game_players, venue_choices, games, push_subscriptions CASCADE;`);
  writeSnapshot();
  for (const [who, name] of Object.entries(NAMES)) {
    await as(who, "GET", "/api/v1/me");
    await as(who, "PUT", "/api/v1/me/name", { name });
    // Nor does the welcome, which a new person sees first.
    await as(who, "POST", "/api/v1/me/welcomed");
    // The Neu card belongs to no screen.
    const notes = await as(who, "GET", "/api/v1/release-notes");
    await as(who, "POST", "/api/v1/release-notes/read", { slugs: notes.items.map((n) => n.slug) });
  }
  // Seb's group, everyone in; Markus's open one, which Seb can join.
  const group = await as("seb", "POST", "/api/v1/groups", {
    name: "Dienstagsrunde",
    kind: "private",
  });
  for (const who of ["anna", "markus", "lisa"]) {
    await as("seb", "POST", `/api/v1/groups/${group.id}/invitations`, { email: EMAIL(who) });
    await as(who, "POST", `/api/v1/groups/${group.id}/join`);
  }
  await as("markus", "POST", "/api/v1/groups", { name: "Offene Runde Klagenfurt", kind: "open" });
  await as("lisa", "POST", "/api/v1/groups", { name: "Feierabend Villach", kind: "on_request" });

  // Evenings, each with a day or two off; Lisa enters fewer days, so the
  // days she left empty show as near misses.
  const evening = { spans: [{ from: 17 * 60, to: 22 * 60 }] };
  const off = { seb: [3], anna: [5], markus: [6], lisa: [0] };
  for (const [i, day] of DAYS.entries())
    for (const who of Object.keys(NAMES))
      if (!off[who].includes(i % (who === "lisa" ? 3 : 7)))
        await as(who, "PUT", `/api/v1/availability/days/${day}`, evening);
  // Seb has thought about his day off; Lisa's stay open.
  await as("seb", "PUT", `/api/v1/availability/days/${DAYS[3]}`, { spans: [], declined: true });
  await as("seb", "PUT", `/api/v1/availability/days/${DAYS[2]}`, {
    spans: [
      { from: 7 * 60, to: 9 * 60 },
      { from: 17 * 60, to: 22 * 60 },
    ],
  });

  // Two games: one booked with all four, one proposed with three in.
  const { fits } = await as("seb", "GET", `/api/v1/groups/${group.id}/fits?minutes=90`);
  if (!fits.length) throw new Error("help-shots: the starting point gives no fits");
  const game = (f) => ({
    venueId: f.venueId,
    court: f.court,
    day: f.day,
    start: f.start,
    minutes: f.minutes,
  });
  const booked = await as("seb", "POST", `/api/v1/groups/${group.id}/games`, game(fits[0]));
  for (const who of ["anna", "markus", "lisa"])
    await as(who, "PUT", `/api/v1/games/${booked.id}/players/me`, { answer: "in" });
  await as("seb", "PATCH", `/api/v1/games/${booked.id}`, { state: "booked" });
  // The fits stop at 40, all on the first day; the second game is a few
  // days on, on a court the fixed snapshot has free then.
  const first = snapshot().venues[0];
  const proposed = await as("seb", "POST", `/api/v1/groups/${group.id}/games`, {
    venueId: first.id,
    court: "Platz 1",
    day: DAYS[4],
    start: 18 * 60,
    minutes: 90,
  });
  await as("anna", "PUT", `/api/v1/games/${proposed.id}/players/me`, { answer: "in" });
  await as("markus", "PUT", `/api/v1/games/${proposed.id}/players/me`, { answer: "in" });
  // One Anna proposed, which waits for Seb's answer on Spielen.
  const asks = await as("anna", "POST", `/api/v1/groups/${group.id}/games`, {
    venueId: first.id,
    court: "Platz 1",
    day: DAYS[5],
    start: 18 * 60,
    minutes: 90,
  });
  await as("lisa", "PUT", `/api/v1/games/${asks.id}/players/me`, { answer: "in" });
  return { group: group.id, game: proposed.id };
}

// --- The pictures ------------------------------------------------------------

/** Each picture: the page, then the part of it from the first locator's top
 * to the last's bottom (the whole width), after an optional step. */
const shots = ({ group, game }) => [
  {
    name: "plaetze",
    // Opening the app, Seb (in a group) starts on Spielen; a tap on Plätze.
    path: "/play",
    step: (page) => page.locator("[data-kit-tabbar] a", { hasText: "Plätze" }).click(),
    from: "section[aria-label=Suche]",
    to: "main article >> nth=0",
    top: 4,
  },
  { name: "zeiten", path: "/availability", from: "h1", to: "main ul li >> nth=5" },
  {
    name: "zeiten-tag",
    path: "/availability",
    step: (page) => page.locator("main ul li button").nth(2).click(),
    from: "main ul li:has(h2)",
    to: "main ul li:has(h2)",
    top: 0,
  },
  { name: "gruppen-finden", path: "/groups", from: "h1", to: "main ul >> nth=0" },
  {
    name: "gruppe",
    path: `/groups/${group}`,
    from: "main section:has(h2:text-is('Mitglieder'))",
    to: "main section:has(h2:text-is('Einladen'))",
  },
  {
    name: "spiele-passt",
    path: `/groups/${group}/fits`,
    from: "main",
    to: "main section >> nth=0 >> li >> nth=2",
    top: 4,
  },
  {
    name: "spiele-fast",
    path: `/groups/${group}/fits`,
    from: "main section:has(h2:text-is('Fast: eine Person fehlt'))",
    to: "main section:has(h2:text-is('Fast: eine Person fehlt')) >> li >> nth=1",
  },
  {
    name: "spiel",
    path: `/games/${game}`,
    from: "main",
    top: 4,
    to: "main section:has(h2:text-is('Buchen'))",
  },
  {
    name: "spielen",
    path: "/play",
    from: "h1",
    to: "main section:has(h2:text-is('Deine Gruppen'))",
  },
];

async function clip(page, { from, to, top: pad = 16 }) {
  const a = await page.locator(from).first().boundingBox();
  const b = await page.locator(to).last().boundingBox();
  if (!a || !b) throw new Error(`help-shots: ${from} or ${to} is not on ${page.url()}`);
  const top = Math.max(0, a.y + (await page.evaluate(() => scrollY)) - pad);
  const bottom = b.y + b.height + (await page.evaluate(() => scrollY)) + 16;
  return { x: 0, y: top, width: page.viewportSize().width, height: bottom - top };
}

/** PNG to WebP at WIDTH, in a blank page of the same browser. */
async function webp(browser, png) {
  const page = await browser.newPage();
  const { url, height } = await page.evaluate(
    async ({ src, width }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.round((img.height * width) / img.width);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      return { url: canvas.toDataURL("image/webp", 0.82), height: canvas.height };
    },
    { src: `data:image/png;base64,${png.toString("base64")}`, width: WIDTH },
  );
  await page.close();
  return { bytes: Buffer.from(url.split(",")[1], "base64"), height };
}

const ids = await seed();
mkdirSync(OUT, { recursive: true });
const app = await openApp({ base: BASE, out: join(tmpdir(), "help-shots"), pace: 400 });
const sizes = {};
const heights = {};
for (const theme of ["light", "dark"]) {
  const phone = await app.signIn({ phone: true });
  await phone.page.emulateMedia({ colorScheme: theme });
  for (const s of shots(ids)) {
    // The courts and the fits ask the sites by themselves once the
    // snapshot is an hour old; a fresh one keeps them on the starting point.
    writeSnapshot();
    const page = await phone.go(s.path);
    await page
      .locator("[aria-busy=true]")
      .first()
      .waitFor({ state: "detached" })
      .catch(() => {});
    if (s.step) {
      await s.step(page);
      await page.waitForLoadState("networkidle");
    }
    // Nor does the iPhone's install hint, or the tab bar fixed over the page.
    await page.addStyleTag({
      content: "aside, [data-kit-tabbar] { display: none !important }",
    });
    await page.mouse.move(0, 0);
    const png = await page.screenshot({
      clip: await clip(page, s),
      fullPage: true,
      animations: "disabled",
    });
    const file = `${s.name}${theme === "dark" ? "-dark" : ""}.webp`;
    const { bytes, height } = await webp(app.browser, png);
    writeFileSync(join(OUT, file), bytes);
    sizes[file] = bytes.length;
    if (theme === "light") heights[s.name] = height;
  }
  if (phone.errors.length) console.warn(`${theme}:`, phone.errors);
  await phone.context.close();
}
await app.close();
// What the Hilfe reserves for each picture before it loads.
const names = Object.keys(heights).sort();
writeFileSync(
  join(here, "../src/help/shots.json"),
  `${JSON.stringify(Object.fromEntries(names.map((n) => [n, { width: WIDTH, height: heights[n] }])), null, 2)}\n`,
);
for (const [file, bytes] of Object.entries(sizes))
  console.log(`${file}\t${Math.round(bytes / 1024)} KB`);
