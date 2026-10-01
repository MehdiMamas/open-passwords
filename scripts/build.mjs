import { build } from "esbuild";
import { cp, mkdir, rm } from "fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

for (const item of ["manifest.json", "src", "icons", "overlay", "fonts"]) {
  await cp(item, `dist/${item}`, { recursive: true });
}

await build({
  entryPoints: ["src/overlay/save-bar.lit.js"],
  bundle: true,
  format: "esm",
  outfile: "dist/overlay/save-bar.js",
  legalComments: "none",
});

console.log("built dist/  (load this folder unpacked)");
