import express from "express";

export function createIngressApp() {
  const app = express();
  app.disable("x-powered-by");
  app.get("/livez", (_request, response) => response.json({ status: "ok" }));
  app.get("/readyz", (_request, response) =>
    response.json({ status: "ready", acceptingWebhooks: false })
  );
  return app;
}
