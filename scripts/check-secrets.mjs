import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readAppConfig, validateAppConfig } from "./app-config.mjs";
const publicConfig = await readAppConfig();
const candidates = new Set();
// Git is the authority for what could be published, including tracked files that
// would now be ignored. Scan built text separately; no credential values are logged.
try {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  );
  for (const file of listed.split("\0").filter(Boolean)) candidates.add(file);
} catch {
  console.error("Run this scan inside the TubeDeck Git repository.");
  process.exit(1);
}
const patterns = [
  /AIza[0-9A-Za-z_-]{35}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /(?:ghp|github_pat)_[A-Za-z0-9_]{30,}/g,
  /"private_key"\s*:\s*"[^"\n]{20,}/g,
];
let files = 0,
  failures = [];
async function scan(dir) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) await scan(file);
    else candidates.add(file);
  }
}
const privatePath =
  /(^|\/)(references|artifacts|node_modules|private|secrets)(\/|$)|(^|\/)HANDOFF-PROMPT\.md$|\.(prompt|handoff)\.md$|(^|\/)\.env(?:\.|$)|(?:service-account|credentials).*\.json$|\.local\.[^/]+$|\.(pem|key|p12|pfx)$/i;
for (const file of candidates) {
  const normalized = file.replaceAll("\\", "/");
  if (privatePath.test(normalized) && !normalized.endsWith(".env.example"))
    failures.push(`${file} (private file is publishable)`);
}
await scan("dist");
for (const file of candidates) {
  if (
    !/\.(?:[cm]?[jt]sx?|json|map|md|html|css|ya?ml|txt|toml|env|ini|cfg|sh|ps1)$|(^|[/\\])(?:LICENSE|\.gitignore|\.env\.example)$/.test(
      file,
    )
  )
    continue;
  let data = await readFile(file, "utf8").catch(() => null);
  if (data === null) continue;
  // Only the designated generated asset may contain the maintainer's public
  // Firebase identifier. Source files, all other assets, and every other key
  // remain fully scanned. Reject unknown fields rather than hiding them.
  if (file.replaceAll("\\", "/") === "dist/app-config.json") {
    try {
      const config = validateAppConfig(JSON.parse(data));
      if (
        config.firebaseApiKey !== publicConfig.firebaseApiKey ||
        config.googleClientId !== publicConfig.googleClientId
      )
        throw new Error(
          "Build configuration differs from local configuration.",
        );
      data = JSON.stringify({
        ...config,
        firebaseApiKey: "[public Firebase identifier]",
      });
    } catch {
      failures.push(`${file} (unexpected public app configuration)`);
    }
  }
  files++;
  if (
    patterns.some((p) => {
      p.lastIndex = 0;
      return p.test(data);
    })
  )
    failures.push(file);
}
if (failures.length) {
  console.error(
    "Possible secrets found. Values are intentionally not printed:\n" +
      failures.join("\n"),
  );
  process.exitCode = 1;
} else
  console.log(
    `No private publishable paths or known credential patterns found in ${files} repository/build text files. This scan is not a guarantee.`,
  );
