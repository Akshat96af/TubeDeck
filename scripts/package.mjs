import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { zipSync, unzipSync } from "fflate";
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
const required = [
  "manifest.json",
  "panel.html",
  "panel.js",
  "panel.css",
  "settings.html",
  "settings.js",
  "settings.css",
  "download.html",
  "download.js",
  "download.css",
  "background.js",
  "content.js",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "PRIVACY.md",
  "README.md",
  "docs/SETUP.md",
  "docs/LIMITATIONS.md",
  ...Object.values(manifest.icons),
];
const files = {};
for (const file of required)
  files[file] = new Uint8Array(await readFile(path.join("dist", file)));
for (const file of await readdir("dist"))
  if (
    /^(panel|settings|download|background|content)\.js\.LEGAL\.txt$/.test(file)
  )
    files[file] = new Uint8Array(await readFile(path.join("dist", file)));
for (const file of await readdir("dist/licenses")) {
  if (!/\.(txt|md|zip)$/.test(file))
    throw new Error("Unexpected license artifact.");
  files[`licenses/${file}`] = new Uint8Array(
    await readFile(path.join("dist/licenses", file)),
  );
}
if (!Object.keys(files).some((p) => p === "licenses/mediabunny-source.zip"))
  throw new Error("Media source attribution is missing.");
const data = zipSync(files, { level: 6 });
const packaged = unzipSync(data);
if (Object.keys(packaged).length !== Object.keys(files).length)
  throw new Error("Archive verification failed.");
await mkdir("releases", { recursive: true });
const name = `TubeDeck-${manifest.version}.zip`;
await writeFile(`releases/${name}`, data);
await writeFile(
  `releases/${name}.sha256`,
  `${createHash("sha256").update(data).digest("hex")}  ${name}\n`,
);
console.log(
  `Packaged ${Object.keys(files).length} explicitly selected files in releases/${name} (${(data.byteLength / 1024 / 1024).toFixed(2)} MB).`,
);
