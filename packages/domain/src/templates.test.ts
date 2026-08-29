import { describe, expect, it } from "vitest";
import {
  type WhatsAppTemplateComponent,
  computeTemplatePayloadHash,
  extractTemplateVariables,
  isTemplateApprovedForSending,
  validateTemplateComponents,
  validateTemplateVariables,
  renderTemplate
} from "./templates.js";

describe("WhatsApp Templates Domain Logic (M3-04)", () => {
  describe("extractTemplateVariables", () => {
    it("extracts unique positional variable indices", () => {
      const text = "Halo {{1}}, pesanan {{2}} Anda sedang diproses. Konfirmasi: {{1}}";
      expect(extractTemplateVariables(text)).toEqual([1, 2]);
    });

    it("returns empty array when text has no variables or is undefined", () => {
      expect(extractTemplateVariables("Halo tidak ada variabel di sini")).toEqual([]);
      expect(extractTemplateVariables(undefined)).toEqual([]);
    });

    it("sorts variables numerically", () => {
      const text = "Item {{10}}, {{2}}, {{1}}";
      expect(extractTemplateVariables(text)).toEqual([1, 2, 10]);
    });
  });

  describe("validateTemplateComponents", () => {
    it("validates valid components with header, body, footer, and buttons", () => {
      const components: WhatsAppTemplateComponent[] = [
        {
          type: "HEADER",
          format: "TEXT",
          text: "Pemberitahuan {{1}}"
        },
        {
          type: "BODY",
          text: "Halo {{2}}, pesanan Anda {{3}} siap dikirim."
        },
        {
          type: "FOOTER",
          text: "Ketik STOP untuk berhenti berlangganan."
        },
        {
          type: "BUTTONS",
          buttons: [
            {
              type: "QUICK_REPLY",
              text: "Lacak Pesanan"
            }
          ]
        }
      ];

      const result = validateTemplateComponents(components);
      expect(result.valid).toBe(true);
      expect(result.variableCount).toBe(3);
    });

    it("fails when BODY component is missing", () => {
      const components: WhatsAppTemplateComponent[] = [
        {
          type: "HEADER",
          format: "TEXT",
          text: "Halo"
        }
      ];

      const result = validateTemplateComponents(components);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("must have exactly one BODY component");
    });

    it("fails when multiple BODY components are present", () => {
      const components: WhatsAppTemplateComponent[] = [
        { type: "BODY", text: "Body 1" },
        { type: "BODY", text: "Body 2" }
      ];

      const result = validateTemplateComponents(components);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("found 2");
    });

    it("fails when BODY text is empty or blank", () => {
      const components: WhatsAppTemplateComponent[] = [{ type: "BODY", text: "   " }];

      const result = validateTemplateComponents(components);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("cannot be empty");
    });

    it("fails when multiple HEADER components are present", () => {
      const components: WhatsAppTemplateComponent[] = [
        { type: "HEADER", format: "TEXT", text: "H1" },
        { type: "HEADER", format: "TEXT", text: "H2" },
        { type: "BODY", text: "Body text" }
      ];

      const result = validateTemplateComponents(components);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("at most one HEADER component");
    });
  });

  describe("computeTemplatePayloadHash", () => {
    it("produces deterministic sha256 hashes", () => {
      const params = {
        category: "UTILITY" as const,
        language: "id",
        components: [{ type: "BODY" as const, text: "Pesanan {{1}} selesai." }]
      };

      const hash1 = computeTemplatePayloadHash(params);
      const hash2 = computeTemplatePayloadHash(params);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("changes hash when text or language changes", () => {
      const base = {
        category: "UTILITY" as const,
        language: "id",
        components: [{ type: "BODY" as const, text: "Pesanan {{1}} selesai." }]
      };

      const diffLang = computeTemplatePayloadHash({ ...base, language: "en_US" });
      const diffText = computeTemplatePayloadHash({
        ...base,
        components: [{ type: "BODY" as const, text: "Pesanan {{1}} dibatalkan." }]
      });

      const original = computeTemplatePayloadHash(base);
      expect(original).not.toBe(diffLang);
      expect(original).not.toBe(diffText);
    });
  });

  describe("isTemplateApprovedForSending", () => {
    it("strictly allows APPROVED status", () => {
      expect(isTemplateApprovedForSending("APPROVED")).toBe(true);
    });

    it("rejects non-approved statuses (drafts, pending, rejected, paused, disabled, appeal)", () => {
      expect(isTemplateApprovedForSending("PENDING")).toBe(false);
      expect(isTemplateApprovedForSending("REJECTED")).toBe(false);
      expect(isTemplateApprovedForSending("PAUSED")).toBe(false);
      expect(isTemplateApprovedForSending("DISABLED")).toBe(false);
      expect(isTemplateApprovedForSending("IN_APPEAL")).toBe(false);
      expect(isTemplateApprovedForSending("DRAFT")).toBe(false);
      expect(isTemplateApprovedForSending("unknown")).toBe(false);
    });
  });

  describe("validateTemplateVariables", () => {
    const components = [
      {
        type: "HEADER" as const,
        format: "TEXT" as const,
        text: "Pemberitahuan {{1}}"
      },
      {
        type: "BODY" as const,
        text: "Halo {{2}}, pesanan Anda {{3}} sedang dikirim."
      }
    ];

    it("accepts exactly matching positional variables", () => {
      const res = validateTemplateVariables(components, {
        "1": "Penting",
        "2": "Budi",
        "3": "ORD-123"
      });
      expect(res.valid).toBe(true);
      expect(res.requiredVariables).toEqual([1, 2, 3]);
      expect(res.missingVariables).toEqual([]);
      expect(res.extraVariables).toEqual([]);
    });

    it("rejects missing variables", () => {
      const res = validateTemplateVariables(components, {
        "1": "Penting",
        "2": "Budi"
        // "3" is missing
      });
      expect(res.valid).toBe(false);
      expect(res.missingVariables).toEqual([3]);
      expect(res.error).toContain("Missing required template variables: {{3}}");
    });

    it("rejects empty or whitespace-only variables", () => {
      const res = validateTemplateVariables(components, {
        "1": "Penting",
        "2": "  ",
        "3": "ORD-123"
      });
      expect(res.valid).toBe(false);
      expect(res.missingVariables).toEqual([2]);
    });

    it("rejects extra unexpected variables", () => {
      const res = validateTemplateVariables(components, {
        "1": "Penting",
        "2": "Budi",
        "3": "ORD-123",
        "4": "unexpected",
        extraKey: "foo"
      });
      expect(res.valid).toBe(false);
      expect(res.extraVariables).toEqual(["4", "extraKey"]);
      expect(res.error).toContain("Unexpected template variables: 4, extraKey");
    });
  });

  describe("renderTemplate", () => {
    const components = [
      {
        type: "HEADER" as const,
        format: "TEXT" as const,
        text: "Halo {{1}}!"
      },
      {
        type: "BODY" as const,
        text: "Tagihan sebesar {{2}} telah lunas pada {{3}}."
      },
      {
        type: "FOOTER" as const,
        text: "FlowDesk Support"
      }
    ];

    it("renders body and header with bound variables and generates deterministic hash", () => {
      const variables = {
        "1": "Siti",
        "2": "Rp 150.000",
        "3": "29 Agustus 2026"
      };

      const result1 = renderTemplate(components, variables);
      const result2 = renderTemplate(components, variables);

      expect(result1.renderedHeader).toBe("Halo Siti!");
      expect(result1.renderedBody).toBe(
        "Tagihan sebesar Rp 150.000 telah lunas pada 29 Agustus 2026."
      );
      expect(result1.renderedPayloadHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result1.renderedPayloadHash).toBe(result2.renderedPayloadHash);

      // Verify components structure
      const renderedHeaderComp = result1.renderedComponents.find((c) => c.type === "HEADER");
      expect(renderedHeaderComp?.text).toBe("Halo Siti!");
      const renderedBodyComp = result1.renderedComponents.find((c) => c.type === "BODY");
      expect(renderedBodyComp?.text).toBe(
        "Tagihan sebesar Rp 150.000 telah lunas pada 29 Agustus 2026."
      );
      const renderedFooterComp = result1.renderedComponents.find((c) => c.type === "FOOTER");
      expect(renderedFooterComp?.text).toBe("FlowDesk Support");
    });

    it("throws error when variables are invalid", () => {
      expect(() => renderTemplate(components, { "1": "Siti" })).toThrow(
        "Missing required template variables"
      );
    });
  });
});
