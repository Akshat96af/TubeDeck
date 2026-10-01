import { build, context } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
const watch = process.argv.includes('--watch');
await mkdir('dist', { recursive: true });
await copyFile('public/manifest.json', 'dist/manifest.json');
for (const page of ['panel', 'settings', 'download']) {
  await writeFile(`dist/${page}.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube Companion</title><link rel="stylesheet" href="${page}.css"></head><body><div id="root"></div><script type="module" src="${page}.js"></script></body></html>`);
}
const bundles = [
  { entryPoints: { panel: 'src/ui/main.tsx', settings: 'src/settings/main.tsx', download: 'src/download/main.tsx', background: 'src/background/index.ts' }, format: 'esm' },
  { entryPoints: { content: 'src/content/index.ts' }, format: 'iife' },
];
for (const bundle of bundles) {
  const options = { ...bundle, bundle: true, outdir: 'dist', target: 'chrome120', sourcemap: watch, minify: !watch, legalComments: 'linked', define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') } };
  if (watch) { const ctx = await context(options); await ctx.watch(); }
  else await build(options);
}
console.log(watch ? 'Watching source changes. Reload the extension after changes.' : 'Built extension in dist/.');
