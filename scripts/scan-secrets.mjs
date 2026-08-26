import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);
const forbidden = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /(?:sk_live_|whsec_)[A-Za-z0-9_-]{16,}/
];
const allowed = new Set(["scripts/scan-secrets.mjs"]);
let failed = false;

for (const file of tracked) {
  if (allowed.has(file)) continue;
  let body;
  try {
    body = execFileSync("git", ["show", `:${file}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    body = await import("node:fs/promises")
      .then(({ readFile }) => readFile(file, "utf8"))
      .catch(() => "");
  }
  if (forbidden.some((pattern) => pattern.test(body))) {
    console.error(`Potential secret in ${file}`);
    failed = true;
  }
}
if (failed) process.exit(1);
