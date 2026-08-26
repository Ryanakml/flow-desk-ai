import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./index.js";

describe("logging redaction contract", () => {
  it("redacts secrets", async () => {
    let output = "";
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        output += chunk.toString("utf8");
        done();
      }
    });
    const logger = createLogger(
      { service: "test", environment: "local", version: "test", level: "info" },
      sink
    );
    logger.info({ token: "must-not-leak" }, "test");
    await new Promise((resolve) => sink.end(resolve));
    expect(output).not.toContain("must-not-leak");
    expect(output).toContain("[REDACTED]");
  });
});
