export interface MalwareScanResult {
  isClean: boolean;
  threatName?: string | undefined;
  scannerVersion: string;
}

export interface MalwareScanner {
  scan(content: Buffer): Promise<MalwareScanResult>;
}

export const EICAR_TEST_SIGNATURE =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export class FakeMalwareScanner implements MalwareScanner {
  private readonly version: string;
  private readonly simulatedThreats = new Set<string>();

  constructor(version = "fake-clamav-1.0.0") {
    this.version = version;
  }

  addSimulatedThreat(threatString: string): void {
    this.simulatedThreats.add(threatString);
  }

  async scan(content: Buffer): Promise<MalwareScanResult> {
    await Promise.resolve();
    const text = content.toString("utf-8");

    // 1. Check standard EICAR antivirus test signature
    if (text.includes(EICAR_TEST_SIGNATURE)) {
      return {
        isClean: false,
        threatName: "EICAR-Standard-Antivirus-Test-File",
        scannerVersion: this.version
      };
    }

    // 2. Check custom simulated threats for testing
    for (const threat of this.simulatedThreats) {
      if (text.includes(threat)) {
        return {
          isClean: false,
          threatName: `Threat:${threat}`,
          scannerVersion: this.version
        };
      }
    }

    return {
      isClean: true,
      scannerVersion: this.version
    };
  }
}

export interface ClamAvScannerOptions {
  host: string;
  port?: number | undefined;
  timeoutMs?: number | undefined;
}

export class ClamAvScanner implements MalwareScanner {
  private readonly options: { host: string; port: number; timeoutMs: number };

  constructor(options: ClamAvScannerOptions) {
    this.options = {
      host: options.host,
      port: options.port ?? 3310,
      timeoutMs: options.timeoutMs ?? 30_000
    };
  }

  async scan(content: Buffer): Promise<MalwareScanResult> {
    const { createConnection } = await import("node:net");
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.options.host, port: this.options.port });
      const response: Buffer[] = [];
      const fail = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      socket.setTimeout(this.options.timeoutMs, () => fail(new Error("ClamAV scan timed out")));
      socket.on("error", fail);
      socket.on("data", (chunk: Buffer) => response.push(chunk));
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < content.length; offset += 64 * 1024) {
          const chunk = content.subarray(offset, Math.min(offset + 64 * 1024, content.length));
          const size = Buffer.allocUnsafe(4);
          size.writeUInt32BE(chunk.length);
          socket.write(size);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
      socket.on("end", () => {
        const result = Buffer.concat(response).toString("utf8").replace(/\0/g, "").trim();
        if (result.endsWith("OK")) {
          resolve({ isClean: true, scannerVersion: "clamav-instream" });
          return;
        }
        const match = result.match(/: (.+) FOUND$/);
        if (match?.[1]) {
          resolve({ isClean: false, threatName: match[1], scannerVersion: "clamav-instream" });
          return;
        }
        reject(new Error(`Unexpected ClamAV response: ${result || "empty response"}`));
      });
    });
  }
}
