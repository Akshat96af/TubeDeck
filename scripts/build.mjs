import { build, context } from "esbuild";
import { mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { writeIcons } from "./icons.mjs";
import { writeLicenses } from "./licenses.mjs";
const watch = process.argv.includes("--watch");
await mkdir("dist", { recursive: true });
await copyFile("public/manifest.json", "dist/manifest.json");
await writeIcons();
for (const file of [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "PRIVACY.md",
  "README.md",
])
  await copyFile(file, `dist/${file}`);
await mkdir("dist/docs", { recursive: true });
for (const file of ["SETUP.md", "LIMITATIONS.md"])
  await copyFile(`docs/${file}`, `dist/docs/${file}`);
for (const page of ["panel", "settings", "download"]) {
  await writeFile(
    `dist/${page}.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TubeDeck</title><link rel="stylesheet" href="${page}.css"></head><body><div id="root"></div><script type="module" src="${page}.js"></script></body></html>`,
  );
}
const bundles = [
  {
    entryPoints: {
      panel: "src/ui/main.tsx",
      settings: "src/settings/main.tsx",
      download: "src/download/main.tsx",
      background: "src/background/index.ts",
    },
    format: "esm",
  },
  { entryPoints: { content: "src/content/index.ts" }, format: "iife" },
];
const inputs = new Set();
for (const bundle of bundles) {
  const options = {
    ...bundle,
    bundle: true,
    outdir: "dist",
    target: "chrome120",
    sourcemap: watch,
    minify: !watch,
    legalComments: "linked",
    metafile: true,
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        watch ? "development" : "production",
      ),
    },
  };
  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
  } else {
    const result = await build(options);
    Object.keys(result.metafile.inputs).forEach((input) => inputs.add(input));
  }
}
if (!watch) {
  for (const entry of [
    "panel",
    "settings",
    "download",
    "background",
    "content",
  ])
    for (const ext of ["js.map", "css.map"])
      await rm(`dist/${entry}.${ext}`, { force: true });
  await writeLicenses(inputs);
}
console.log(
  watch
    ? "Watching source changes. Reload the extension after changes."
    : "Built extension in dist/.",
);
