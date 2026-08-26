import { execFileSync } from "node:child_process";

const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "HEAD~1";
let files = [];
try {
  files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
} catch {
  files = ["repository-bootstrap"];
}
const workspaces = [
  ...new Set(files.map((file) => file.match(/^(apps|packages)\/[^/]+/)?.[0]).filter(Boolean))
];
console.log(JSON.stringify({ files, workspaces }));
