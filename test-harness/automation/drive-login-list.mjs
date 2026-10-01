import { fileURLToPath } from "url";

const pw = await import(process.env.OP_PW || new URL("../../node_modules/playwright/index.js", import.meta.url));
const { chromium } = pw.default || pw;
const BASE = process.env.OP_BASE || "http://127.0.0.1:8799";
const MANY = process.env.OP_EXT || fileURLToPath(new URL("./.builds/many", import.meta.url));
const MULTI = process.env.OP_MULTI || fileURLToPath(new URL("./.builds/multi", import.meta.url));
const results = [];
const ok = (n, c, d) => {
  results.push(!!c);
  console.log(`${c ? "PASS" : "FAIL"} ${n}${c ? "" : " -> " + d}`);
};

function attrs(node) {
  const a = {};
  const list = node.attributes || [];
  for (let i = 0; i < list.length; i += 2) a[list[i]] = list[i + 1];
  return a;
}

async function pierced(page) {
  const client = await page.context().newCDPSession(page);
  const { root } = await client.send("DOM.getDocument", { depth: -1, pierce: true });
  const nodes = [];
  (function walk(node) {
    nodes.push(node);
    for (const s of node.shadowRoots || []) walk(s);
    for (const c of node.children || []) walk(c);
  })(root);
  const host = nodes.find((n) => attrs(n)["data-passbridge"] === "suggestions");
  const textOf = (node) => {
    const bits = [];
    const walk = (n) => {
      if (n.nodeName === "#text" && n.nodeValue?.trim()) bits.push(n.nodeValue.trim());
      for (const s of n.shadowRoots || []) walk(s);
      for (const c of n.children || []) walk(c);
    };
    for (const s of node?.shadowRoots || []) walk(s);
    return bits.join(" ");
  };
  const find = (pred) => nodes.find(pred);
  async function call(node, fn) {
    const { object } = await client.send("DOM.resolveNode", { nodeId: node.nodeId });
    const { result } = await client.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: fn,
      returnByValue: true,
    });
    return result.value;
  }
  async function click(node) {
    const { model } = await client.send("DOM.getBoxModel", { nodeId: node.nodeId });
    const [x1, y1, x2, y2] = model.content;
    await page.mouse.click((x1 + x2) / 2, (y1 + y2) / 2);
  }
  return { client, nodes, host, textOf, find, call, click };
}

async function openMany(page) {
  await page.goto(`${BASE}/login-standard.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  await page.focus('input[name="username"]');
  await page.waitForTimeout(600);
}

const manyCtx = await chromium.launchPersistentContext("/tmp/op-login-list-" + Date.now(), {
  headless: false,
  args: [`--disable-extensions-except=${MANY}`, `--load-extension=${MANY}`, "--headless=new", "--no-first-run"],
});
manyCtx.serviceWorkers()[0] || (await manyCtx.waitForEvent("serviceworker", { timeout: 10000 }).catch(() => null));
const page = await manyCtx.newPage();
await openMany(page);

let view = await pierced(page);
const opened = view.textOf(view.host);
ok("long list offers a username search", !!view.find((n) => attrs(n).placeholder === "Search usernames"), opened.slice(0, 180));
const listNode = view.find((n) => attrs(n)["data-passbridge-login-list"]);
const metrics = listNode
  ? await view.call(listNode, "function(){return {clientHeight:this.clientHeight,scrollHeight:this.scrollHeight,overflowY:getComputedStyle(this).overflowY}}")
  : null;
ok(
  "list scrolls inside a 6-row cap",
  metrics && metrics.scrollHeight > metrics.clientHeight && metrics.clientHeight > 0 && metrics.clientHeight <= 280 && metrics.overflowY === "auto",
  JSON.stringify(metrics),
);
ok("later usernames stay in the list", /jake@example.com/.test(opened), opened.slice(0, 240));

for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowDown");
view = await pierced(page);
const scrolled = await view.call(
  view.find((n) => attrs(n)["data-passbridge-login-list"]),
  "function(){return this.scrollTop}",
);
ok("arrow down scrolls the list", scrolled > 0, String(scrolled));

await page.fill('input[name="username"]', "mehdi");
await page.waitForTimeout(150);
view = await pierced(page);
const filtered = view.textOf(view.host);
const searchValue = await view.call(
  view.find((n) => attrs(n).placeholder === "Search usernames"),
  "function(){return this.value}",
);
ok(
  "page username filters to mehdi only",
  /mehdi\.one@example\.com/.test(filtered) && /mehdi\.two@example\.com/.test(filtered) && !/alice@example.com/.test(filtered) && !/jake@example.com/.test(filtered),
  filtered,
);
ok("search box follows the username field", searchValue === "mehdi", searchValue);

const searchNode = view.find((n) => attrs(n).placeholder === "Search usernames");
await view.client.send("DOM.focus", { nodeId: searchNode.nodeId });
await page.keyboard.press("Control+A");
await page.keyboard.type("riot");
await page.waitForTimeout(150);
view = await pierced(page);
const siteMiss = view.textOf(view.host);
ok("search matches username only", /No matching usernames/.test(siteMiss) && !/alice@example.com/.test(siteMiss), siteMiss);

await view.client.send("DOM.focus", { nodeId: view.find((n) => attrs(n).placeholder === "Search usernames").nodeId });
await page.keyboard.press("Control+A");
await page.keyboard.type("mehdi.one");
await page.waitForTimeout(150);
view = await pierced(page);
const nameNode = view.nodes.find((n) => (n.children || []).some((c) => c.nodeValue?.trim() === "mehdi.one@example.com"));
await view.click(nameNode);
await page.waitForTimeout(400);
ok(
  "filtered row fills the username",
  (await page.inputValue('input[name="username"]')) === "mehdi.one@example.com",
  await page.inputValue('input[name="username"]'),
);

await page.goto(`${BASE}/login-standard.html`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(300);
await page.focus('input[name="password"]');
await page.waitForTimeout(600);
await page.fill('input[name="password"]', "alice");
await page.waitForTimeout(200);
view = await pierced(page);
const pwText = view.textOf(view.host);
ok("password text is not a username query", /alice@example.com/.test(pwText) && /jake@example.com/.test(pwText), pwText.slice(0, 240));

await view.client.send("DOM.focus", { nodeId: view.find((n) => attrs(n).placeholder === "Search usernames").nodeId });
for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowDown");
const fromSearch = await pierced(page);
const searchScrolled = await fromSearch.call(
  fromSearch.find((n) => attrs(n)["data-passbridge-login-list"]),
  "function(){return this.scrollTop}",
);
ok("arrow keys scroll while the search field is focused", searchScrolled > 0, String(searchScrolled));
await page.keyboard.press("Escape");
ok(
  "escape returns to the page field",
  await page.evaluate(() => document.activeElement?.id === "password"),
  await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName),
);

await page.goto(`${BASE}/signup.html`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(300);
await page.focus("#new-password");
await page.waitForTimeout(600);
view = await pierced(page);
const signup = view.textOf(view.host);
const signupList = view.find((n) => attrs(n)["data-passbridge-login-list"]);
const signupMetrics = await view.call(
  signupList,
  "function(){return {clientHeight:this.clientHeight,scrollHeight:this.scrollHeight}}",
);
ok(
  "generator stays under the capped list",
  /Strong Password/.test(signup) && /Without Special Characters/.test(signup) && signupMetrics.scrollHeight > signupMetrics.clientHeight,
  signup.slice(0, 240) + " " + JSON.stringify(signupMetrics),
);
await manyCtx.close();

const multiCtx = await chromium.launchPersistentContext("/tmp/op-login-list-multi-" + Date.now(), {
  headless: false,
  args: [`--disable-extensions-except=${MULTI}`, `--load-extension=${MULTI}`, "--headless=new", "--no-first-run"],
});
multiCtx.serviceWorkers()[0] || (await multiCtx.waitForEvent("serviceworker", { timeout: 10000 }).catch(() => null));
const multi = await multiCtx.newPage();
await multi.goto(`${BASE}/login-standard.html`, { waitUntil: "domcontentloaded" });
await multi.waitForTimeout(300);
await multi.focus('input[name="username"]');
await multi.waitForTimeout(600);
const multiView = await pierced(multi);
const multiText = multiView.textOf(multiView.host);
const multiList = multiView.find((n) => attrs(n)["data-passbridge-login-list"]);
const multiMetrics = multiList
  ? await multiView.call(multiList, "function(){return {scrollHeight:this.scrollHeight,clientHeight:this.clientHeight,overflowY:getComputedStyle(this).overflowY}}")
  : null;
ok(
  "two logins stay a short list without search",
  /alice@example.com/.test(multiText) &&
    /bob@work.com/.test(multiText) &&
    !multiView.find((n) => attrs(n).placeholder === "Search usernames") &&
    multiMetrics &&
    multiMetrics.scrollHeight <= multiMetrics.clientHeight + 1 &&
    multiMetrics.overflowY !== "auto",
  multiText + " " + JSON.stringify(multiMetrics),
);
await multiCtx.close();

const failed = results.filter((r) => !r).length;
console.log(`\n==== ${results.length - failed}/${results.length} PASS ====`);
process.exit(failed ? 1 : 0);
