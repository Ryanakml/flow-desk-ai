import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

const repoRoot = path.resolve(__dirname, "../../..");
const canaryScript = path.join(repoRoot, "infra/deploy/production/canary-traffic.sh");
const evaluateScript = path.join(repoRoot, "infra/deploy/production/evaluate-canary-gate.sh");
const provenanceScript = path.join(repoRoot, "infra/deploy/production/verify-provenance.sh");
const recordScript = path.join(repoRoot, "infra/deploy/production/record-deployment.sh");

interface MockTrafficState {
  canaryWeight: number;
  stableWeight: number;
  updatedAt: string;
}

interface ProvenanceRecord {
  sourceSha: string;
  verifiedAt: string;
  digests: Record<string, string>;
}

interface DeploymentGate {
  name: string;
  passed: boolean;
  timestamp: string;
  error?: string;
  skipped?: boolean;
}

interface DeploymentRecord {
  id: string;
  sourceSha: string;
  imageDigests: Record<string, string>;
  actor: string;
  environment: string;
  canaryWeights: number[];
  migrationApplied: boolean;
  gates: DeploymentGate[];
  outcome: string;
  deployedAt: string;
}

describe("Production Deployment Scripts Integration Tests (M5-07 / #181, #203)", () => {
  describe("canary-traffic.sh", () => {
    it("fails closed when weight argument is missing", () => {
      expect(() => {
        execFileSync(canaryScript, [], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"]
        });
      }).toThrow();
    });

    it("fails closed when weight argument is invalid", () => {
      expect(() => {
        execFileSync(canaryScript, ["50"], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"]
        });
      }).toThrow(/Invalid canary weight/);
    });

    it("fails closed when required production infrastructure ARNs are missing", () => {
      expect(() => {
        execFileSync(canaryScript, ["5"], {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            FLOWDESK_MOCK_TRAFFIC_CONTROLLER: "false",
            PROD_LISTENER_ARN: "",
            PROD_STABLE_TG_ARN: "",
            PROD_CANARY_TG_ARN: ""
          },
          stdio: ["pipe", "pipe", "pipe"]
        });
      }).toThrow(/Missing required production infrastructure configuration/);
    });

    it("correctly calculates and applies weights in mock mode (5%, 25%, 100%, 0%)", () => {
      const stateFile = path.join(os.tmpdir(), "canary-test-state-" + Date.now() + ".json");
      const mockEnv = {
        ...process.env,
        FLOWDESK_MOCK_TRAFFIC_CONTROLLER: "true",
        MOCK_TRAFFIC_STATE_FILE: stateFile,
        PROD_LISTENER_ARN: "arn:aws:elasticloadbalancing:ap-southeast-1:123:listener/app/alb/1",
        PROD_STABLE_TG_ARN: "arn:aws:elasticloadbalancing:ap-southeast-1:123:targetgroup/stable/1",
        PROD_CANARY_TG_ARN: "arn:aws:elasticloadbalancing:ap-southeast-1:123:targetgroup/canary/1"
      };

      // 5% slice
      execFileSync(canaryScript, ["5"], { cwd: repoRoot, env: mockEnv, encoding: "utf8" });
      let state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as MockTrafficState;
      expect(state.canaryWeight).toBe(5);
      expect(state.stableWeight).toBe(95);

      // 25% slice
      execFileSync(canaryScript, ["25"], { cwd: repoRoot, env: mockEnv, encoding: "utf8" });
      state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as MockTrafficState;
      expect(state.canaryWeight).toBe(25);
      expect(state.stableWeight).toBe(75);

      // 100% full promotion
      execFileSync(canaryScript, ["100"], { cwd: repoRoot, env: mockEnv, encoding: "utf8" });
      state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as MockTrafficState;
      expect(state.canaryWeight).toBe(100);
      expect(state.stableWeight).toBe(0);

      // Rollback to 0%
      execFileSync(canaryScript, ["0"], { cwd: repoRoot, env: mockEnv, encoding: "utf8" });
      state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as MockTrafficState;
      expect(state.canaryWeight).toBe(0);
      expect(state.stableWeight).toBe(100);

      fs.unlinkSync(stateFile);
    });
  });

  describe("evaluate-canary-gate.sh", () => {
    it("fails closed when CANARY_ENDPOINT_URL is missing", () => {
      expect(() => {
        execFileSync(evaluateScript, ["5"], {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            FLOWDESK_MOCK_CANARY_PROBE: "false",
            CANARY_ENDPOINT_URL: ""
          },
          stdio: ["pipe", "pipe", "pipe"]
        });
      }).toThrow(/CANARY_ENDPOINT_URL is not set/);
    });

    it("rejects localhost in real mode", () => {
      expect(() => {
        execFileSync(evaluateScript, ["5"], {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            FLOWDESK_MOCK_CANARY_PROBE: "false",
            CANARY_ENDPOINT_URL: "http://127.0.0.1:4000"
          },
          stdio: ["pipe", "pipe", "pipe"]
        });
      }).toThrow(/Localhost is not a valid production canary endpoint/);
    });

    it("passes evaluation in mock probe mode", () => {
      const output = execFileSync(evaluateScript, ["5"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          FLOWDESK_MOCK_CANARY_PROBE: "true",
          MOCK_CANARY_FAIL: "false"
        }
      });
      expect(output).toContain("Canary gate for 5% traffic slice PASSED");
    });

    it("triggers exit code 2 on simulated SLO / health failure", () => {
      let exitCode = 0;
      try {
        execFileSync(evaluateScript, ["25"], {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            FLOWDESK_MOCK_CANARY_PROBE: "true",
            MOCK_CANARY_FAIL: "true"
          },
          stdio: ["pipe", "pipe", "pipe"]
        });
      } catch (err: unknown) {
        if (err && typeof err === "object" && "status" in err) {
          exitCode = Number((err as { status: number }).status);
        }
      }
      expect(exitCode).toBe(2);
    });
  });

  describe("verify-provenance.sh", () => {
    it("fails closed when SHA argument is missing", () => {
      expect(() => {
        execFileSync(provenanceScript, [], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"]
        });
      }).toThrow(/Source SHA argument is required/);
    });

    it("rejects mutable tags like latest", () => {
      expect(() => {
        execFileSync(provenanceScript, ["latest"], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"]
        });
      }).toThrow(/Production promotion strictly requires an immutable 40-character commit SHA/);
    });

    it("generates verified sha256 digests file in mock mode", () => {
      const outFile = path.join(os.tmpdir(), "provenance-test-" + Date.now() + ".json");
      const sha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
      execFileSync(provenanceScript, [sha, outFile], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          FLOWDESK_MOCK_PROVENANCE: "true"
        }
      });

      const record = JSON.parse(fs.readFileSync(outFile, "utf8")) as ProvenanceRecord;
      expect(record.sourceSha).toBe(sha);
      const services = ["web", "api", "ingress", "worker", "scheduler", "migrator"];
      for (const svc of services) {
        expect(record.digests[svc]).toMatch(
          /^ghcr\.io\/ryanakml\/flowdesk-[a-z]+@sha256:[0-9a-f]{64}$/
        );
      }
      fs.unlinkSync(outFile);
    });
  });

  describe("record-deployment.sh", () => {
    const validSha = "1fed41e3a777ea017222d27aada4c2929b9a4f6a";

    it("records promoted release with immutable sha256 digests and passed gates", () => {
      const digestsFile = path.join(os.tmpdir(), "test-digests-" + Date.now() + ".json");
      const recordFile = path.join(os.tmpdir(), "test-record-" + Date.now() + ".json");

      fs.writeFileSync(
        digestsFile,
        JSON.stringify({
          digests: {
            web: "ghcr.io/ryanakml/flowdesk-web@sha256:1111111111111111111111111111111111111111111111111111111111111111",
            api: "ghcr.io/ryanakml/flowdesk-api@sha256:2222222222222222222222222222222222222222222222222222222222222222",
            ingress:
              "ghcr.io/ryanakml/flowdesk-ingress@sha256:3333333333333333333333333333333333333333333333333333333333333333",
            worker:
              "ghcr.io/ryanakml/flowdesk-worker@sha256:4444444444444444444444444444444444444444444444444444444444444444",
            scheduler:
              "ghcr.io/ryanakml/flowdesk-scheduler@sha256:5555555555555555555555555555555555555555555555555555555555555555",
            migrator:
              "ghcr.io/ryanakml/flowdesk-migrator@sha256:6666666666666666666666666666666666666666666666666666666666666666"
          }
        })
      );

      execFileSync(recordScript, [validSha, "promoted", "test-actor", recordFile], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          DIGESTS_FILE: digestsFile
        }
      });

      const record = JSON.parse(fs.readFileSync(recordFile, "utf8")) as DeploymentRecord;
      expect(record.outcome).toBe("promoted");
      expect(record.canaryWeights).toEqual([5, 25, 100]);
      expect(record.gates.every((g: DeploymentGate) => g.passed === true)).toBe(true);
      expect(record.imageDigests["web"]).toContain("@sha256:");

      fs.unlinkSync(digestsFile);
      fs.unlinkSync(recordFile);
    });

    it("records rolled_back release with failed gate details", () => {
      const recordFile = path.join(os.tmpdir(), "test-record-rollback-" + Date.now() + ".json");

      execFileSync(recordScript, [validSha, "rolled_back", "test-actor", recordFile], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          FAILED_STAGE: "canary_5pct"
        }
      });

      const record = JSON.parse(fs.readFileSync(recordFile, "utf8")) as DeploymentRecord;
      expect(record.outcome).toBe("rolled_back");
      expect(record.canaryWeights).toEqual([0]);
      const canary5Gate = record.gates.find((g: DeploymentGate) => g.name === "canary_5pct");
      expect(canary5Gate?.passed).toBe(false);

      fs.unlinkSync(recordFile);
    });
  });
});
