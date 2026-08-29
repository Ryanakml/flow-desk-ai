export type WhatsAppTemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";
export type WhatsAppTemplateStatus =
  "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED" | "IN_APPEAL";

export interface WhatsAppTemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO" | "LOCATION";
  text?: string;
  buttons?: unknown[];
  example?: unknown;
}

export interface ComponentValidationResult {
  valid: boolean;
  error?: string;
  variableCount: number;
}

/**
 * Extracts positional variables (e.g. {{1}}, {{2}}) from component text.
 */
export function extractTemplateVariables(text: string | undefined): number[] {
  if (!text) return [];
  const matches = text.matchAll(/\{\{(\d+)\}\}/g);
  const indices: number[] = [];
  for (const match of matches) {
    const num = Number.parseInt(match[1]!, 10);
    if (!Number.isNaN(num) && !indices.includes(num)) {
      indices.push(num);
    }
  }
  return indices.sort((a, b) => a - b);
}

/**
 * Validates template component structure and variable counts.
 * Rule:
 * - Exactly one BODY component is required.
 * - At most one HEADER, FOOTER, BUTTONS component.
 * - Body text must be non-empty string.
 */
export function validateTemplateComponents(
  components: WhatsAppTemplateComponent[]
): ComponentValidationResult {
  const bodyComponents = components.filter((c) => c.type === "BODY");
  if (bodyComponents.length !== 1) {
    return {
      valid: false,
      error: `Template must have exactly one BODY component, found ${bodyComponents.length}`,
      variableCount: 0
    };
  }

  const body = bodyComponents[0]!;
  if (!body.text || body.text.trim().length === 0) {
    return {
      valid: false,
      error: "Template BODY component text cannot be empty",
      variableCount: 0
    };
  }

  const headerComponents = components.filter((c) => c.type === "HEADER");
  if (headerComponents.length > 1) {
    return {
      valid: false,
      error: `Template can have at most one HEADER component, found ${headerComponents.length}`,
      variableCount: 0
    };
  }

  const footerComponents = components.filter((c) => c.type === "FOOTER");
  if (footerComponents.length > 1) {
    return {
      valid: false,
      error: `Template can have at most one FOOTER component, found ${footerComponents.length}`,
      variableCount: 0
    };
  }

  const buttonComponents = components.filter((c) => c.type === "BUTTONS");
  if (buttonComponents.length > 1) {
    return {
      valid: false,
      error: `Template can have at most one BUTTONS component, found ${buttonComponents.length}`,
      variableCount: 0
    };
  }

  let totalVariables = 0;
  totalVariables += extractTemplateVariables(body.text).length;

  if (headerComponents.length > 0 && headerComponents[0]?.text) {
    totalVariables += extractTemplateVariables(headerComponents[0].text).length;
  }

  return {
    valid: true,
    variableCount: totalVariables
  };
}

function sha256Hex(ascii: string): string {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }

  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  for (let i = 0; i < ascii.length; i++) {
    const j = ascii.charCodeAt(i);
    const wordIdx = i >> 2;
    words[wordIdx] = (words[wordIdx] ?? 0) | (j << ((3 - (i % 4)) * 8));
  }
  const padIdx = ascii.length >> 2;
  words[padIdx] = (words[padIdx] ?? 0) | (0x80 << ((3 - (ascii.length % 4)) * 8));
  const lenIdx = (((ascii.length + 8) >> 6) << 4) + 15;
  words[lenIdx] = asciiBitLength;

  const w = new Array<number>(64);
  for (let i = 0; i < words.length; i += 16) {
    let [a, b, c, d, e, f, g, h] = hash as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number
    ];
    for (let j = 0; j < 64; j++) {
      if (j < 16) {
        w[j] = (words[i + j] ?? 0) | 0;
      } else {
        const s0 =
          rightRotate(w[j - 15] ?? 0, 7) ^
          rightRotate(w[j - 15] ?? 0, 18) ^
          ((w[j - 15] ?? 0) >>> 3);
        const s1 =
          rightRotate(w[j - 2] ?? 0, 17) ^
          rightRotate(w[j - 2] ?? 0, 19) ^
          ((w[j - 2] ?? 0) >>> 10);
        w[j] = ((w[j - 16] ?? 0) + s0 + (w[j - 7] ?? 0) + s1) | 0;
      }
      const ch = (e & f) ^ (~e & g);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const temp1 = (h + s1 + ch + (k[j] ?? 0) + (w[j] ?? 0)) | 0;
      const temp2 = (s0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    hash[0] = ((hash[0] ?? 0) + a) | 0;
    hash[1] = ((hash[1] ?? 0) + b) | 0;
    hash[2] = ((hash[2] ?? 0) + c) | 0;
    hash[3] = ((hash[3] ?? 0) + d) | 0;
    hash[4] = ((hash[4] ?? 0) + e) | 0;
    hash[5] = ((hash[5] ?? 0) + f) | 0;
    hash[6] = ((hash[6] ?? 0) + g) | 0;
    hash[7] = ((hash[7] ?? 0) + h) | 0;
  }

  return hash.map((val) => (val >>> 0).toString(16).padStart(8, "0")).join("");
}

/**
 * Computes a deterministic SHA-256 hash representing the template components, language, and category.
 */
export function computeTemplatePayloadHash(params: {
  category: WhatsAppTemplateCategory;
  language: string;
  components: WhatsAppTemplateComponent[];
}): string {
  const normalized = {
    category: params.category,
    language: params.language.toLowerCase().trim(),
    components: params.components.map((c) => ({
      type: c.type,
      format: c.format ?? null,
      text: c.text ?? null,
      buttons: c.buttons ?? null
    }))
  };

  return sha256Hex(JSON.stringify(normalized));
}

/**
 * Determines whether a template status permits outbound message sending.
 * Only templates marked strictly as "APPROVED" by the provider may be dispatched.
 */
export function isTemplateApprovedForSending(status: string): boolean {
  return status === "APPROVED";
}
