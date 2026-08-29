import { describe, expect, it } from "vitest";
import { FakeMalwareScanner, EICAR_TEST_SIGNATURE } from "./scanner.js";

describe("Malware Scanner (M3-06)", () => {
  it("approves clean file buffer", async () => {
    const scanner = new FakeMalwareScanner();
    const cleanBuffer = Buffer.from("Just a regular clean document or image content");

    const result = await scanner.scan(cleanBuffer);
    expect(result.isClean).toBe(true);
    expect(result.threatName).toBeUndefined();
    expect(result.scannerVersion).toContain("fake-clamav");
  });

  it("detects standard EICAR test signature and fails closed", async () => {
    const scanner = new FakeMalwareScanner();
    const eicarBuffer = Buffer.from(EICAR_TEST_SIGNATURE);

    const result = await scanner.scan(eicarBuffer);
    expect(result.isClean).toBe(false);
    expect(result.threatName).toBe("EICAR-Standard-Antivirus-Test-File");
  });

  it("detects simulated custom threats", async () => {
    const scanner = new FakeMalwareScanner();
    scanner.addSimulatedThreat("WORM_TROJAN_PAYLOAD");

    const maliciousBuffer = Buffer.from("Binary data ... WORM_TROJAN_PAYLOAD ... trailing");
    const result = await scanner.scan(maliciousBuffer);

    expect(result.isClean).toBe(false);
    expect(result.threatName).toBe("Threat:WORM_TROJAN_PAYLOAD");
  });
});
