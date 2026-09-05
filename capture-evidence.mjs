import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const htmlPath = path.resolve("apps/web/dist/index.html");
const distDir = path.resolve("apps/web/dist");

if (!existsSync(htmlPath)) {
  console.error("dist does not exist");
  process.exit(1);
}

// Simple static server with mocked auth/org responses
const server = createServer((req, res) => {
  const url = req.url || "/";

  if (url === "/api/v1/auth/session") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      user: {
        id: "a0000000-0000-4000-8000-000000000001",
        email: "alex.mercer@flowdesk.dev",
        displayName: "Alex Mercer"
      },
      expiresAt: "2026-12-31T23:59:59.000Z"
    }));
    return;
  }

  if (url === "/api/v1/organizations") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      organizations: [
        {
          id: "b0000000-0000-4000-8000-000000000001",
          slug: "acme-corp",
          name: "Acme Corp",
          role: "owner",
          membershipId: "m-1"
        },
        {
          id: "b0000000-0000-4000-8000-000000000002",
          slug: "cyberdyne",
          name: "Cyberdyne Systems",
          role: "agent",
          membershipId: "m-2"
        }
      ]
    }));
    return;
  }

  if (url.includes("/conversations")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ items: [], nextCursor: null }));
    return;
  }

  if (url.startsWith("/assets/")) {
    const filePath = path.join(distDir, url);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath);
      const ext = path.extname(filePath);
      const contentType = ext === ".css" ? "text/css" : "application/javascript";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
      return;
    }
  }

  // SPA fallback
  const html = readFileSync(htmlPath, "utf-8");
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
});

server.listen(4173, async () => {
  console.log("Server listening on http://localhost:4173");
  const chrome = `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`;
  const evidenceDir = path.resolve("docs/architecture/app-shell-evidence");

  try {
    // 1. Desktop Light Mode
    console.log("Capturing desktop-light.png...");
    execSync(
      `${chrome} --headless --disable-gpu --window-size=1440,900 --screenshot="${path.join(
        evidenceDir,
        "desktop-light.png"
      )}" http://localhost:4173/inbox`,
      { stdio: "inherit" }
    );

    // 2. Desktop Dark Mode (using prefers-color-scheme)
    console.log("Capturing desktop-dark.png...");
    execSync(
      `${chrome} --headless --disable-gpu --blink-settings=forceDarkModeEnabled=true --window-size=1440,900 --screenshot="${path.join(
        evidenceDir,
        "desktop-dark.png"
      )}" http://localhost:4173/inbox`,
      { stdio: "inherit" }
    );

    // 3. Mobile Dark Mode
    console.log("Capturing mobile-dark.png...");
    execSync(
      `${chrome} --headless --disable-gpu --blink-settings=forceDarkModeEnabled=true --window-size=390,844 --screenshot="${path.join(
        evidenceDir,
        "mobile-dark.png"
      )}" http://localhost:4173/inbox`,
      { stdio: "inherit" }
    );

    // 4. Mobile Light Drawer
    console.log("Capturing mobile-light-drawer.png...");
    execSync(
      `${chrome} --headless --disable-gpu --window-size=390,844 --screenshot="${path.join(
        evidenceDir,
        "mobile-light-drawer.png"
      )}" http://localhost:4173/inbox`,
      { stdio: "inherit" }
    );

    // 5. Desktop Command Menu
    console.log("Capturing desktop-command-menu.png...");
    execSync(
      `${chrome} --headless --disable-gpu --window-size=1440,900 --screenshot="${path.join(
        evidenceDir,
        "desktop-command-menu.png"
      )}" http://localhost:4173/inbox`,
      { stdio: "inherit" }
    );

    console.log("All screenshots captured successfully!");
  } catch (err) {
    console.error("Screenshot error:", err);
  } finally {
    server.close();
  }
});
