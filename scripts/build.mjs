import { build } from "esbuild";
import { cp, mkdir, rm } from "fs/promises";
import { execFileSync } from "child_process";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

for (const item of ["manifest.json", "src", "icons", "overlay", "fonts"]) {
  await cp(item, `dist/${item}`, { recursive: true });
}
await rm("dist/src/ui", { recursive: true, force: true });
await cp("src/ui/preview.html", "dist/src/preview.html");

const alias = {
  "@bitwarden/common/vault/enums": "./src/shims/bw-cipher-type.js",
  "@bitwarden/common/autofill/constants": "./src/shims/bw-autofill-constants.js",
  "@bitwarden/common/autofill/types": "./src/shims/bw-autofill-types.js",
};

await build({
  entryPoints: ["src/content.js"],
  bundle: true,
  format: "iife",
  outfile: "dist/src/content.js",
  alias,
  legalComments: "none",
});

await build({
  entryPoints: {
    popup: "src/ui/popup.jsx",
    options: "src/ui/options.jsx",
    preview: "src/ui/preview.jsx",
  },
  bundle: true,
  format: "esm",
  jsx: "automatic",
  minify: true,
  define: { "process.env.NODE_ENV": "\"production\"" },
  outdir: "dist/src",
  legalComments: "none",
});

await build({
  entryPoints: ["src/ui/save-prompt.jsx"],
  bundle: true,
  format: "esm",
  jsx: "automatic",
  minify: true,
  define: { "process.env.NODE_ENV": "\"production\"" },
  outfile: "dist/overlay/save-bar.js",
  legalComments: "none",
});

execFileSync(
  process.execPath,
  ["node_modules/@tailwindcss/cli/dist/index.mjs", "-i", "src/ui/theme.css", "-o", "dist/src/ui.css", "--minify"],
  { stdio: "inherit" },
);

if (process.env.PB_PREVIEW !== "1") {
  await rm("dist/src/preview.js", { force: true });
  await rm("dist/src/preview.html", { force: true });
}

console.log("built dist/  (load this folder unpacked)");
