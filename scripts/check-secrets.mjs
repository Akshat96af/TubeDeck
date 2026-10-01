import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
  const data = await readFile(file, "utf8").catch(() => null);
  if (data === null) continue;
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
