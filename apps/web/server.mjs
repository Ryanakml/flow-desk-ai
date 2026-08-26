import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { loadHttpConfig } from "@flowdesk/config";
import sirv from "sirv";

const config = loadHttpConfig("web", 3000);
const serve = sirv(fileURLToPath(new URL(".", import.meta.url)), { single: true, dev: false });
const server = createServer((request, response) => {
  if (request.url === "/livez" || request.url === "/readyz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "web" }));
    return;
  }
  serve(request, response);
});
server.listen(config.PORT);
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close());
