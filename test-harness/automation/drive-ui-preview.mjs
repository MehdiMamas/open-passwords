import { pathToFileURL } from "url";
import { mkdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const pw = await import(process.env.OP_PW || pathToFileURL(join(HERE, "..", "..", "node_modules", "playwright", "index.js")).href);
const { chromium } = pw.default || pw;
const pageUrl = process.env.OP_PREVIEW || "http://127.0.0.1:8801/src/preview.html";
const shots = join(HERE, "shots");
await mkdir(shots, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
await page.goto(pageUrl, { waitUntil: "networkidle" });
await page.screenshot({ path: join(shots, "ui-preview.png"), fullPage: true });
const count = await page.locator("[data-screen]").count();
console.log(`preview screens: ${count}`);
if (count !== 8) {
  console.error("expected 8 screens (4 states x light/dark)");
  process.exit(1);
}
await browser.close();
console.log("wrote", join(shots, "ui-preview.png"));
