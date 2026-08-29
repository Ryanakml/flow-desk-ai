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
