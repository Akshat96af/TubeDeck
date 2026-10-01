import {
  mkdir,
  readdir,
  readFile,
  copyFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
export async function writeLicenses(inputs) {
  await mkdir("dist/licenses", { recursive: true });
  const names = new Set();
  for (const input of inputs) {
    const normalized = input.replaceAll("\\", "/");
    if (!normalized.includes("node_modules/")) continue;
    const parts = normalized.split("node_modules/").at(-1).split("/");
    names.add(
      parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0],
    );
  }
  const rows = [
    "# Bundled dependencies",
    "",
    "The original license texts accompany this list. TubeDeck does not modify these dependency sources.",
    "",
  ];
  for (const name of [...names].sort()) {
    const root = path.join("node_modules", name),
      p = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const legal = (await readdir(root)).filter((f) =>
      /^(LICENSE|COPYING|NOTICE)(\.|$)/i.test(f),
    );
    if (!legal.length) throw new Error(`Missing license text for ${name}`);
    rows.push(
      `- ${p.name} ${p.version} — ${p.license ?? "see license"} — ${p.homepage ?? p.repository?.url ?? ""}`,
    );
    for (const file of legal)
      await copyFile(
        path.join(root, file),
        path.join("dist/licenses", `${name.replaceAll("/", "_")}-${file}.txt`),
      );
  }
  // Supply the exact unmodified MPL-covered source with the media-library binary.
  if (names.has("mediabunny")) {
    const files = {};
    async function collect(dir) {
      for (const file of await readdir(
        path.join("node_modules/mediabunny", dir),
        { withFileTypes: true },
      )) {
        const key = path.posix.join(dir, file.name);
        if (file.isDirectory()) await collect(key);
        else
          files[key] = new Uint8Array(
            await readFile(path.join("node_modules/mediabunny", key)),
          );
      }
    }
    await collect("src");
    for (const file of ["LICENSE", "package.json"])
      files[file] = new Uint8Array(
        await readFile(`node_modules/mediabunny/${file}`),
      );
    await writeFile(
      "dist/licenses/mediabunny-source.zip",
      zipSync(files, { level: 6 }),
    );
    rows.push(
      "",
      "Mediabunny source form is included in `mediabunny-source.zip`, under its MPL 2.0 terms.",
    );
  }
  await writeFile("dist/licenses/DEPENDENCIES.md", rows.join("\n") + "\n");
}
