// Re-download the tracked Bitwarden autofill files and leave a diff you can read.
// Usage: node scripts/sync-bitwarden.mjs [commit]
// Default commit is vendor/bitwarden/PINNED. Pass a new commit to move the pin
// after you have reviewed the diff and re-applied patches/.

import { execFileSync } from "child_process";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";

const root = process.cwd();
const pinPath = join(root, "vendor/bitwarden/PINNED");
const listPath = join(root, "scripts/bitwarden-tracked.txt");
const commit = process.argv[2] || (await readFile(pinPath, "utf8")).trim();
const tracked = (await readFile(listPath, "utf8")).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

const stamp = join(root, "vendor/bitwarden/.sync-tmp");
await mkdir(stamp, { recursive: true });

for (const rel of tracked) {
  const url = `https://raw.githubusercontent.com/bitwarden/clients/${commit}/${rel}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`missing ${res.status} ${rel}`);
    process.exitCode = 1;
    continue;
  }
  const body = await res.text();
  const dest = join(stamp, rel.replace(/^apps\/browser\/src\/autofill\//, ""));
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, body);
}

console.log(`downloaded ${tracked.length} files from ${commit} into vendor/bitwarden/.sync-tmp`);
try {
  const diff = execFileSync("git", ["diff", "--no-index", "--stat", "vendor/bitwarden", "vendor/bitwarden/.sync-tmp"], {
    encoding: "utf8",
  });
  console.log(diff);
} catch (err) {
  const out = `${err.stdout || ""}${err.stderr || ""}`;
  console.log(out || "(no diff tool output)");
}
console.log("Review that diff. Copy the files you want into vendor/bitwarden/, update PINNED, then re-apply patches/.");
if (process.argv[2]) {
  console.log(`To pin this commit after review: write ${commit} to vendor/bitwarden/PINNED`);
}
