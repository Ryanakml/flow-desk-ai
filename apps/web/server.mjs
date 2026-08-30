import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { loadHttpConfig } from "@flowdesk/config";
import sirv from "sirv";

const config = loadHttpConfig("web", 3000);
const serve = sirv(fileURLToPath(new URL(".", import.meta.url)), { single: true, dev: false });
const server = createServer((request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
  );
  if (request.url === "/livez" || request.url === "/readyz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "web" }));
    return;
  }
  serve(request, response);
});
server.listen(config.PORT, "0.0.0.0");
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close());
