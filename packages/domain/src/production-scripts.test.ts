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
const deployWorkloadScript = path.join(repoRoot, "infra/deploy/production/deploy-workload.sh");
const verifyWorkloadScript = path.join(repoRoot, "infra/deploy/production/verify-workload.sh");

interface MockTrafficState {
  canaryWeight: number;
  stableWeight: number;
  updatedAt: string;
}

interface MockWorkloadState {
  slice: string;
  updatedAt: string;
  cluster: string;
  service: string;
  targetGroupArn: string;
  status: string;
  runningDigests: Record<string, string>;
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
  expectedDigests?: Record<string, string>;
  deployedDigests?: Record<string, string>;
  workloadVerified?: boolean;
  actor: string;
  environment: string;
  canaryWeights: number[];
  migrationApplied: boolean;
  gates: DeploymentGate[];
  outcome: string;
  deployedAt: string;
}

function setupStubAws(
  config: Record<string, { output?: string; error?: string; exitCode?: number }>
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stub-aws-"));
  const awsBin = path.join(tempDir, "aws");
  const configFile = path.join(tempDir, "stub-aws-config.json");
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));

  const stubScript = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const configFile = process.env.STUB_AWS_CONFIG_FILE;
if (!configFile || !fs.existsSync(configFile)) {
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));

let matchedKey = null;
let bestMatchLength = 0;
const joined = args.join(' ');
for (const key of Object.keys(config)) {
  if (joined.startsWith(key) && key.length > bestMatchLength) {
    matchedKey = key;
    bestMatchLength = key.length;
  }
}

if (!matchedKey) {
  const cmd = args.slice(0, 2).join(' ');
  if (config[cmd]) {
    matchedKey = cmd;
  }
}

if (matchedKey && config[matchedKey]) {
  const entry = config[matchedKey];
  if (entry.output) process.stdout.write(entry.output);
  if (entry.error) process.stderr.write(entry.error);
  process.exit(entry.exitCode !== undefined ? entry.exitCode : 0);
}

process.stdout.write('{}');
process.exit(0);
`;

  fs.writeFileSync(awsBin, stubScript, { mode: 0o755 });

  return {
    binDir: tempDir,
    configFile,
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

describe("Production Deployment Scripts Integration Tests (M5-07 / #181, #203, #205)", () => {
  const sampleDigests = {
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
  };

  describe("deploy-workload.sh", () => {
    it("fails closed when slice argument is missing", () => {
      expect(() => {
        execFileSync(deployWorkloadScript, [], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"]
        });
      }).toThrow(/Workload slice argument is required/);
    });

    it("fails closed when slice is invalid", () => {
      expect(() => {
        execFileSync(deployWorkloadScript, ["invalid-slice"], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"]
        });
      }).toThrow(/Invalid workload slice/);
    });

    it("fails closed when digests file does not exist", () => {
      expect(() => {
        execFileSync(deployWorkloadScript, ["canary", "/nonexistent/digests.json"], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"]
        });
      }).toThrow(/Digests file .* not found/);
    });

    it("fails closed when running task digest does not match expected digest", () => {
      const digestsFile = path.join(os.tmpdir(), "mismatch-digests-" + Date.now() + ".json");
      fs.writeFileSync(digestsFile, JSON.stringify({ digests: sampleDigests }));

      expect(() => {
        execFileSync(deployWorkloadScript, ["canary", digestsFile], {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            FLOWDESK_MOCK_COMPUTE_CONTROLLER: "true",
            MOCK_DIGEST_MISMATCH: "true"
          },
          stdio: ["pipe", "pipe", "pipe"]
        });
      }).toThrow(/Running digest mismatch/);

      fs.unlinkSync(digestsFile);
    });

    it("deploys verified digests to canary workload and verifies task health", () => {
      const digestsFile = path.join(os.tmpdir(), "canary-digests-" + Date.now() + ".json");
      const stateFile = path.join(os.tmpdir(), "canary-state-" + Date.now() + ".json");
      fs.writeFileSync(digestsFile, JSON.stringify({ digests: sampleDigests }));

      const output = execFileSync(deployWorkloadScript, ["canary", digestsFile], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          FLOWDESK_MOCK_COMPUTE_CONTROLLER: "true",
          MOCK_WORKLOAD_STATE_FILE: stateFile
        }
      });

      expect(output).toContain("Workload for canary successfully deployed");
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as MockWorkloadState;
      expect(state.slice).toBe("canary");
      expect(state.status).toBe("HEALTHY");
      expect(state.runningDigests["api"]).toBe(sampleDigests["api"]);

      fs.unlinkSync(digestsFile);
      fs.unlinkSync(stateFile);
    });

    it("deploys verified release to stable workload during 100% promotion catchup", () => {
      const digestsFile = path.join(os.tmpdir(), "stable-digests-" + Date.now() + ".json");
      const stateFile = path.join(os.tmpdir(), "stable-state-" + Date.now() + ".json");
      fs.writeFileSync(digestsFile, JSON.stringify({ digests: sampleDigests }));

      const output = execFileSync(deployWorkloadScript, ["stable", digestsFile], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          FLOWDESK_MOCK_COMPUTE_CONTROLLER: "true",
          MOCK_WORKLOAD_STATE_FILE: stateFile
        }
      });

      expect(output).toContain("Workload for stable successfully deployed");
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as MockWorkloadState;
      expect(state.slice).toBe("stable");
      expect(state.status).toBe("HEALTHY");
      expect(state.runningDigests["api"]).toBe(sampleDigests["api"]);

      fs.unlinkSync(digestsFile);
      fs.unlinkSync(stateFile);
    });

    it("executes non-mock AWS path and correctly parses exported TASK_DEF_JSON, RUNNING_TASK_ARNS, DESCRIBE_TASKS_JSON, and TG_HEALTH", () => {
      const digestsFile = path.join(os.tmpdir(), "nonmock-digests-" + Date.now() + ".json");
      fs.writeFileSync(digestsFile, JSON.stringify({ digests: sampleDigests }));

      const stub = setupStubAws({
        "ecs describe-services": {
          output:
            "arn:aws:ecs:ap-southeast-1:123456789012:task-definition/flowdesk-production-api-canary:1\n"
        },
        "ecs describe-task-definition": {
          output: JSON.stringify({
            family: "flowdesk-production-api-canary",
            taskDefinitionArn:
              "arn:aws:ecs:ap-southeast-1:123456789012:task-definition/flowdesk-production-api-canary:1",
            revision: 1,
            containerDefinitions: [
              { name: "api", image: "ghcr.io/ryanakml/flowdesk-api:old" },
              { name: "web", image: "ghcr.io/ryanakml/flowdesk-web:old" }
            ]
          })
        },
        "ecs register-task-definition": {
          output: JSON.stringify({
            taskDefinition: {
              taskDefinitionArn:
                "arn:aws:ecs:ap-southeast-1:123456789012:task-definition/flowdesk-production-api-canary:2"
            }
          })
        },
        "ecs update-service": {
          output: ""
        },
        "ecs wait services-stable": {
          output: ""
        },
        "ecs list-tasks": {
          output: '["arn:aws:ecs:ap-southeast-1:123456789012:task/cluster/task-canary-1"]\n'
        },
        "ecs describe-tasks": {
          output: JSON.stringify({
            tasks: [
              {
                taskArn: "arn:aws:ecs:ap-southeast-1:123456789012:task/cluster/task-canary-1",
                containers: [
                  {
                    name: "api",
                    image: sampleDigests.api,
                    imageDigest: sampleDigests.api.split("@")[1]
                  },
                  {
                    name: "web",
                    image: sampleDigests.web,
                    imageDigest: sampleDigests.web.split("@")[1]
                  }
                ]
              }
            ]
          })
        },
        "elbv2 describe-target-health": {
          output: '["healthy"]\n'
        }
      });

      try {
        const output = execFileSync(deployWorkloadScript, ["canary", digestsFile], {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${stub.binDir}:${process.env["PATH"]}`,
            STUB_AWS_CONFIG_FILE: stub.configFile,
            FLOWDESK_MOCK_COMPUTE_CONTROLLER: "false",
            ECS_CLUSTER_NAME: "flowdesk-production-cluster",
            ECS_SERVICE_NAME: "flowdesk-production-canary-api",
            PROD_CANARY_TG_ARN:
              "arn:aws:elasticloadbalancing:ap-southeast-1:123:targetgroup/canary/1",
            AWS_REGION: "ap-southeast-1"
          }
        });

        expect(output).toContain("Registered new task definition");
        expect(output).toContain(
          "All running tasks verified executing expected immutable digests."
        );
        expect(output).toContain("All 1 targets in");
        expect(output).toContain(
          "Workload deployment for canary completed successfully and verified."
        );
      } finally {
        stub.cleanup();
        fs.unlinkSync(digestsFile);
      }
    });

    it("fails closed in non-mock AWS path when running container digest differs from expected", () => {
      const digestsFile = path.join(os.tmpdir(), "nonmock-fail-digests-" + Date.now() + ".json");
      fs.writeFileSync(digestsFile, JSON.stringify({ digests: sampleDigests }));

      const stub = setupStubAws({
        "ecs describe-services": {
          output:
            "arn:aws:ecs:ap-southeast-1:123456789012:task-definition/flowdesk-production-api-canary:1\n"
        },
        "ecs describe-task-definition": {
          output: JSON.stringify({
            family: "flowdesk-production-api-canary",
            taskDefinitionArn:
              "arn:aws:ecs:ap-southeast-1:123456789012:task-definition/flowdesk-production-api-canary:1",
            revision: 1,
            containerDefinitions: [{ name: "api", image: "old" }]
          })
        },
        "ecs register-task-definition": {
          output: JSON.stringify({
            taskDefinition: {
              taskDefinitionArn:
                "arn:aws:ecs:ap-southeast-1:123456789012:task-definition/flowdesk-production-api-canary:2"
            }
          })
        },
        "ecs update-service": { output: "" },
        "ecs wait services-stable": { output: "" },
        "ecs list-tasks": {
          output: '["arn:aws:ecs:ap-southeast-1:123456789012:task/cluster/task-1"]\n'
        },
        "ecs describe-tasks": {
          output: JSON.stringify({
            tasks: [
              {
                taskArn: "arn:aws:ecs:ap-southeast-1:123456789012:task/cluster/task-1",
                containers: [
                  {
                    name: "api",
                    image:
                      "ghcr.io/ryanakml/flowdesk-api@sha256:0000000000000000000000000000000000000000000000000000000000000000",
                    imageDigest:
                      "sha256:0000000000000000000000000000000000000000000000000000000000000000"
                  }
                ]
              }
            ]
          })
        },
        "elbv2 describe-target-health": { output: '["healthy"]\n' }
      });

      try {
        expect(() => {
          execFileSync(deployWorkloadScript, ["canary", digestsFile], {
            cwd: repoRoot,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${stub.binDir}:${process.env["PATH"]}`,
              STUB_AWS_CONFIG_FILE: stub.configFile,
              FLOWDESK_MOCK_COMPUTE_CONTROLLER: "false",
              ECS_CLUSTER_NAME: "flowdesk-production-cluster",
              ECS_SERVICE_NAME: "flowdesk-production-canary-api",
              PROD_CANARY_TG_ARN:
                "arn:aws:elasticloadbalancing:ap-southeast-1:123:targetgroup/canary/1",
              AWS_REGION: "ap-southeast-1"
            },
            stdio: ["pipe", "pipe", "pipe"]
          });
        }).toThrow(/running digest mismatch/);
      } finally {
        stub.cleanup();
        fs.unlinkSync(digestsFile);
      }
    });

    it("fails closed in non-mock AWS path when target health check reports unhealthy targets", () => {
      const digestsFile = path.join(os.tmpdir(), "nonmock-unhealthy-" + Date.now() + ".json");
      fs.writeFileSync(digestsFile, JSON.stringify({ digests: sampleDigests }));

      const stub = setupStubAws({
        "ecs describe-services": {
          output:
            "arn:aws:ecs:ap-southeast-1:123456789012:task-definition/flowdesk-production-api-canary:1\n"
        },
        "ecs describe-task-definition": {
          output: JSON.stringify({
            family: "flowdesk-production-api-canary",
            taskDefinitionArn:
              "arn:aws:ecs:ap-southeast-1:123456789012:task-definition/flowdesk-production-api-canary:1",
            revision: 1,
            containerDefinitions: [{ name: "api", image: "old" }]
          })
        },
        "ecs register-task-definition": {
          output: JSON.stringify({
            taskDefinition: {
              taskDefinitionArn:
                "arn:aws:ecs:ap-southeast-1:123456789012:task-definition/flowdesk-production-api-canary:2"
            }
          })
        },
        "ecs update-service": { output: "" },
        "ecs wait services-stable": { output: "" },
        "ecs list-tasks": {
          output: '["arn:aws:ecs:ap-southeast-1:123456789012:task/cluster/task-1"]\n'
        },
        "ecs describe-tasks": {
          output: JSON.stringify({
            tasks: [
              {
                taskArn: "arn:aws:ecs:ap-southeast-1:123456789012:task/cluster/task-1",
                containers: [
                  {
                    name: "api",
                    image: sampleDigests.api,
                    imageDigest: sampleDigests.api.split("@")[1]
                  },
                  {
                    name: "web",
                    image: sampleDigests.web,
                    imageDigest: sampleDigests.web.split("@")[1]
                  }
                ]
              }
            ]
          })
        },
        "elbv2 describe-target-health": {
          output: '["unhealthy"]\n'
        }
      });

      try {
        expect(() => {
          execFileSync(deployWorkloadScript, ["canary", digestsFile], {
            cwd: repoRoot,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${stub.binDir}:${process.env["PATH"]}`,
              STUB_AWS_CONFIG_FILE: stub.configFile,
              FLOWDESK_MOCK_COMPUTE_CONTROLLER: "false",
              ECS_CLUSTER_NAME: "flowdesk-production-cluster",
              ECS_SERVICE_NAME: "flowdesk-production-canary-api",
              PROD_CANARY_TG_ARN:
                "arn:aws:elasticloadbalancing:ap-southeast-1:123:targetgroup/canary/1",
              AWS_REGION: "ap-southeast-1"
            },
            stdio: ["pipe", "pipe", "pipe"]
          });
        }).toThrow(/Target group .* has unhealthy targets/);
      } finally {
        stub.cleanup();
        fs.unlinkSync(digestsFile);
      }
    });
  });

  describe("verify-workload.sh", () => {
    it("confirms running workload matches expected digests in mock mode", () => {
      const digestsFile = path.join(os.tmpdir(), "v-digests-" + Date.now() + ".json");
      const stateFile = path.join(os.tmpdir(), "v-state-" + Date.now() + ".json");
      fs.writeFileSync(digestsFile, JSON.stringify({ digests: sampleDigests }));
      fs.writeFileSync(
        stateFile,
        JSON.stringify({
          slice: "canary",
          status: "HEALTHY",
          runningDigests: sampleDigests
        })
      );

      const output = execFileSync(verifyWorkloadScript, ["canary", digestsFile], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          FLOWDESK_MOCK_COMPUTE_CONTROLLER: "true",
          MOCK_WORKLOAD_STATE_FILE: stateFile
        }
      });

      expect(output).toContain(
        "Verified running digests match expected immutable references for canary"
      );

      fs.unlinkSync(digestsFile);
      fs.unlinkSync(stateFile);
    });

    it("fails closed when running workload has not been deployed", () => {
      const digestsFile = path.join(os.tmpdir(), "nonexist-state-test.json");
      fs.writeFileSync(digestsFile, JSON.stringify({ digests: sampleDigests }));

      expect(() => {
        execFileSync(verifyWorkloadScript, ["canary", digestsFile], {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            FLOWDESK_MOCK_COMPUTE_CONTROLLER: "true",
            MOCK_WORKLOAD_STATE_FILE: "/nonexistent/mock-state.json"
          },
          stdio: ["pipe", "pipe", "pipe"]
        });
      }).toThrow(/Mock workload state file .* not found/);

      fs.unlinkSync(digestsFile);
    });

    it("executes non-mock AWS path and correctly parses exported RUNNING_TASK_ARNS and DESCRIBE_TASKS_JSON", () => {
      const digestsFile = path.join(os.tmpdir(), "v-nonmock-digests-" + Date.now() + ".json");
      fs.writeFileSync(digestsFile, JSON.stringify({ digests: sampleDigests }));

      const stub = setupStubAws({
        "ecs list-tasks": {
          output: '["arn:aws:ecs:ap-southeast-1:123456789012:task/cluster/task-v1"]\n'
        },
        "ecs describe-tasks": {
          output: JSON.stringify({
            tasks: [
              {
                taskArn: "arn:aws:ecs:ap-southeast-1:123456789012:task/cluster/task-v1",
                containers: [
                  {
                    name: "api",
                    image: sampleDigests.api,
                    imageDigest: sampleDigests.api.split("@")[1]
                  },
                  {
                    name: "web",
                    image: sampleDigests.web,
                    imageDigest: sampleDigests.web.split("@")[1]
                  }
                ]
              }
            ]
          })
        }
      });

      try {
        const output = execFileSync(verifyWorkloadScript, ["canary", digestsFile], {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${stub.binDir}:${process.env["PATH"]}`,
            STUB_AWS_CONFIG_FILE: stub.configFile,
            FLOWDESK_MOCK_COMPUTE_CONTROLLER: "false",
            ECS_CLUSTER_NAME: "flowdesk-production-cluster",
            ECS_SERVICE_NAME: "flowdesk-production-canary-api",
            AWS_REGION: "ap-southeast-1"
          }
        });

        expect(output).toContain("Running tasks confirmed executing expected immutable digests.");
      } finally {
        stub.cleanup();
        fs.unlinkSync(digestsFile);
      }
    });

    it("fails closed in non-mock AWS path when running digest mismatch occurs", () => {
      const digestsFile = path.join(os.tmpdir(), "v-nonmock-mismatch-" + Date.now() + ".json");
      fs.writeFileSync(digestsFile, JSON.stringify({ digests: sampleDigests }));

      const stub = setupStubAws({
        "ecs list-tasks": {
          output: '["arn:aws:ecs:ap-southeast-1:123456789012:task/cluster/task-v1"]\n'
        },
        "ecs describe-tasks": {
          output: JSON.stringify({
            tasks: [
              {
                taskArn: "arn:aws:ecs:ap-southeast-1:123456789012:task/cluster/task-v1",
                containers: [
                  {
                    name: "api",
                    image:
                      "ghcr.io/ryanakml/flowdesk-api@sha256:9999999999999999999999999999999999999999999999999999999999999999",
                    imageDigest:
                      "sha256:9999999999999999999999999999999999999999999999999999999999999999"
                  }
                ]
              }
            ]
          })
        }
      });

      try {
        expect(() => {
          execFileSync(verifyWorkloadScript, ["canary", digestsFile], {
            cwd: repoRoot,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${stub.binDir}:${process.env["PATH"]}`,
              STUB_AWS_CONFIG_FILE: stub.configFile,
              FLOWDESK_MOCK_COMPUTE_CONTROLLER: "false",
              ECS_CLUSTER_NAME: "flowdesk-production-cluster",
              ECS_SERVICE_NAME: "flowdesk-production-canary-api",
              AWS_REGION: "ap-southeast-1"
            },
            stdio: ["pipe", "pipe", "pipe"]
          });
        }).toThrow(/Running digest mismatch for api/);
      } finally {
        stub.cleanup();
        fs.unlinkSync(digestsFile);
      }
    });

    it("fails closed in non-mock AWS path when no running tasks are returned", () => {
      const digestsFile = path.join(os.tmpdir(), "v-nonmock-notasks-" + Date.now() + ".json");
      fs.writeFileSync(digestsFile, JSON.stringify({ digests: sampleDigests }));

      const stub = setupStubAws({
        "ecs list-tasks": {
          output: "[]\n"
        }
      });

      try {
        expect(() => {
          execFileSync(verifyWorkloadScript, ["canary", digestsFile], {
            cwd: repoRoot,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${stub.binDir}:${process.env["PATH"]}`,
              STUB_AWS_CONFIG_FILE: stub.configFile,
              FLOWDESK_MOCK_COMPUTE_CONTROLLER: "false",
              ECS_CLUSTER_NAME: "flowdesk-production-cluster",
              ECS_SERVICE_NAME: "flowdesk-production-canary-api",
              AWS_REGION: "ap-southeast-1"
            },
            stdio: ["pipe", "pipe", "pipe"]
          });
        }).toThrow(/No running tasks found/);
      } finally {
        stub.cleanup();
        fs.unlinkSync(digestsFile);
      }
    });
  });

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

    it("executes non-mock AWS path and correctly parses exported DESCRIBE_OUTPUT from stubbed AWS CLI", () => {
      const stub = setupStubAws({
        "elbv2 modify-listener": { output: "" },
        "elbv2 describe-listeners": {
          output: JSON.stringify({
            Listeners: [
              {
                ListenerArn: "arn:aws:elasticloadbalancing:ap-southeast-1:123:listener/app/alb/1",
                DefaultActions: [
                  {
                    Type: "forward",
                    ForwardConfig: {
                      TargetGroups: [
                        {
                          TargetGroupArn:
                            "arn:aws:elasticloadbalancing:ap-southeast-1:123:targetgroup/stable/1",
                          Weight: 95
                        },
                        {
                          TargetGroupArn:
                            "arn:aws:elasticloadbalancing:ap-southeast-1:123:targetgroup/canary/1",
                          Weight: 5
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          })
        }
      });

      try {
        const output = execFileSync(canaryScript, ["5"], {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${stub.binDir}:${process.env["PATH"]}`,
            STUB_AWS_CONFIG_FILE: stub.configFile,
            FLOWDESK_MOCK_TRAFFIC_CONTROLLER: "false",
            PROD_LISTENER_ARN: "arn:aws:elasticloadbalancing:ap-southeast-1:123:listener/app/alb/1",
            PROD_STABLE_TG_ARN:
              "arn:aws:elasticloadbalancing:ap-southeast-1:123:targetgroup/stable/1",
            PROD_CANARY_TG_ARN:
              "arn:aws:elasticloadbalancing:ap-southeast-1:123:targetgroup/canary/1",
            AWS_REGION: "ap-southeast-1"
          }
        });

        expect(output).toContain("Verified active AWS ALB weights: Stable=95%, Canary=5%");
        expect(output).toContain(
          "Canary weight 5% successfully established and verified on AWS ALB."
        );
      } finally {
        stub.cleanup();
      }
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

      fs.writeFileSync(digestsFile, JSON.stringify({ digests: sampleDigests }));

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
      expect(record.workloadVerified).toBe(true);
      expect(record.expectedDigests).toBeDefined();
      expect(record.deployedDigests).toBeDefined();

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
          FAILED_STAGE: "canary_deploy"
        }
      });

      const record = JSON.parse(fs.readFileSync(recordFile, "utf8")) as DeploymentRecord;
      expect(record.outcome).toBe("rolled_back");
      expect(record.canaryWeights).toEqual([0]);
      const canaryDeployGate = record.gates.find(
        (g: DeploymentGate) => g.name === "canary_workload_deployed"
      );
      expect(canaryDeployGate?.passed).toBe(false);

      fs.unlinkSync(recordFile);
    });

    it("records rolled_back release on full promotion / stable catchup failure", () => {
      const recordFile = path.join(
        os.tmpdir(),
        "test-record-rollback-full-" + Date.now() + ".json"
      );

      execFileSync(recordScript, [validSha, "rolled_back", "test-actor", recordFile], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          FAILED_STAGE: "full_promotion"
        }
      });

      const record = JSON.parse(fs.readFileSync(recordFile, "utf8")) as DeploymentRecord;
      expect(record.outcome).toBe("rolled_back");
      expect(record.canaryWeights).toEqual([0]);
      const canary100Gate = record.gates.find((g: DeploymentGate) => g.name === "canary_100pct");
      expect(canary100Gate?.passed).toBe(false);
      const stableWorkloadGate = record.gates.find(
        (g: DeploymentGate) => g.name === "stable_workload_promoted"
      );
      expect(stableWorkloadGate?.passed).toBe(false);
      expect(stableWorkloadGate?.skipped).toBe(true);

      fs.unlinkSync(recordFile);
    });
  });
});
