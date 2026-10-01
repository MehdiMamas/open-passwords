// mock extension variants so no macOS helper or real PIN is needed, output to .builds/

import { mkdir, rm, cp, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const DIST = join(REPO, "dist");
const OUT = join(HERE, ".builds");

function mockKindModule(kind) {
  return `export const MOCK_KIND = ${JSON.stringify(kind)};\n`;
}

const KINDS = ["unlocked", "multi", "locked", "pinflow", "otp"];

await rm(OUT, { recursive: true, force: true });
for (const kind of KINDS) {
  const dst = join(OUT, kind);
  await mkdir(dst, { recursive: true });
  for (const item of ["manifest.json", "src", "icons", "overlay", "fonts"]) {
    await cp(join(DIST, item), join(dst, item), { recursive: true });
  }
  await writeFile(join(dst, "src", "session", "mock-kind.js"), mockKindModule(kind));
  console.log(`built ${kind} -> ${dst}`);
}
console.log("\nDone. Test builds are in test-harness/automation/.builds/");
