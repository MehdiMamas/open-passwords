import { fileURLToPath } from "url";
const pw = await import(process.env.OP_PW || "/tmp/op-test/node_modules/playwright/index.js");
const { chromium } = pw.default || pw;
const BASE = process.env.OP_BASE || "http://127.0.0.1:8799";
const EXT = process.env.OP_EXT || fileURLToPath(new URL("./.builds/unlocked", import.meta.url));
const results = [];
const ok = (n, c, d) => { results.push(c); console.log(`${c ? "PASS" : "FAIL"} ${n}${c ? "" : " -> " + d}`); };

const ctx = await chromium.launchPersistentContext("/tmp/op-menu-" + Date.now(), {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--headless=new", "--no-first-run"],
});
ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 10000 }).catch(() => null));
const page = await ctx.newPage();
await page.goto(`${BASE}/login-standard.html`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(300);
await page.focus('input[name="username"]');
await page.waitForTimeout(500);

const host = page.locator('[data-passbridge-host="menu"]');
ok("menu host is up", (await host.count()) > 0, "no host");
const shadow = await page.evaluate(() => {
  const el = document.querySelector('[data-passbridge-host="menu"]');
  if (!el) return "missing";
  return el.shadowRoot === null ? "closed" : "open";
});
ok("menu host shadow is closed", shadow === "closed", shadow);
ok("field icon is up", (await page.locator("[data-passbridge-icon]").count()) > 0, "no icon");
const text = await page.locator('[data-passbridge="suggestions"]').innerText();
ok("suggestions still readable", /test@example.com/.test(text), text);

await ctx.close();
const failed = results.filter((r) => !r).length;
console.log(`\n==== ${results.length - failed}/${results.length} PASS ====`);
process.exit(failed ? 1 : 0);
