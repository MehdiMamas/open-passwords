// Download one pinned upstream and show the diff against vendor/<name>/.
// Usage: node scripts/sync-upstream.mjs <bitwarden|au2001|open-passwords> [commit] [--accept]
// --accept copies the download over the vendor mirror and writes PINNED.

import { cp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { dirname, join, relative } from "path";

const root = process.cwd();

function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}
const args = process.argv.slice(2).filter((arg) => arg !== "--accept");
const accept = process.argv.includes("--accept");
const name = args[0];
const catalog = JSON.parse(await readFile(join(root, "upstreams.json"), "utf8"));
const spec = catalog[name];
if (!spec) {
  console.error(`Unknown upstream "${name}". Known: ${Object.keys(catalog).join(", ")}`);
  process.exit(1);
}

const pinPath = join(root, spec.pin);
const pinned = (await readFile(pinPath, "utf8")).trim();
const commit = args[1] || pinned;
const paths = spec.pathsFile
  ? (await readFile(join(root, spec.pathsFile), "utf8")).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
  : spec.paths;

const stamp = join(root, "vendor", name, ".sync-tmp");
await rm(stamp, { recursive: true, force: true });
await mkdir(stamp, { recursive: true });

let failed = false;
for (const rel of paths) {
  const url = `https://raw.githubusercontent.com/${spec.repo}/${commit}/${rel}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`missing ${res.status} ${rel}`);
    failed = true;
    continue;
  }
  const destRel = spec.strip && rel.startsWith(spec.strip) ? rel.slice(spec.strip.length) : rel;
  const dest = join(stamp, destRel);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, await res.text());
}
if (failed) process.exit(1);

console.log(`downloaded ${paths.length} files from ${spec.repo}@${commit}`);
const mirror = join(root, "vendor", name);
const downloaded = await collectedFiles(stamp);
let dirty = 0;
for (const file of downloaded) {
  const rel = relative(stamp, file);
  const currentPath = join(mirror, rel);
  const next = normalize(await readFile(file, "utf8"));
  let current = null;
  try {
    current = normalize(await readFile(currentPath, "utf8"));
  } catch {
    current = null;
  }
  if (current === next) continue;
  dirty += 1;
  console.log(`${current == null ? "new" : "changed"} ${rel}`);
}
console.log(dirty ? `${dirty} file(s) differ from vendor/${name}/` : "no diff");

async function collectedFiles(dir) {
  const { readdir } = await import("fs/promises");
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectedFiles(path)));
    else out.push(path);
  }
  return out;
}

if (accept) {
  await cp(stamp, mirror, { recursive: true });
  await rm(stamp, { recursive: true, force: true });
  await writeFile(pinPath, `${commit}\n`);
  console.log(`accepted ${name} @ ${commit}`);
} else {
  console.log(commit === pinned ? "Pin matches. Pass --accept to refresh the mirror." : `Review the diff, then re-run with --accept to pin ${commit}.`);
}
