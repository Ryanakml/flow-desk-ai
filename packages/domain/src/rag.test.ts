import { describe, it, expect } from "vitest";
import { buildCitations, formatKnowledgeContext, assemblePromptContext } from "./rag.js";

describe("Semantic RAG Retrieval Domain Engine", () => {
  it("builds citations and formats snippets cleanly", () => {
    const rawChunks = [
      {
        id: "chunk-1",
        content: "FlowDesk supports WhatsApp multi-tenant team inbox routing.",
        similarity: 0.92345,
        metadata: { documentTitle: "FlowDesk Features Guide" }
      },
      {
        id: "chunk-2",
        content: "SLA response time for P1 critical issues is 15 minutes.",
        similarity: 0.812,
        metadata: {}
      }
    ];

    const citations = buildCitations(rawChunks);

    expect(citations).toHaveLength(2);
    expect(citations[0]?.documentTitle).toBe("FlowDesk Features Guide");
    expect(citations[0]?.score).toBe(0.9234);
    expect(citations[1]?.documentTitle).toBe("Knowledge Document");

    const formattedContext = formatKnowledgeContext(citations);
    expect(formattedContext).toContain("[Source 1: FlowDesk Features Guide (Relevance: 92%)]");
    expect(formattedContext).toContain(
      "FlowDesk supports WhatsApp multi-tenant team inbox routing."
    );
  });

  it("handles empty citations gracefully", () => {
    const formatted = formatKnowledgeContext([]);
    expect(formatted).toBe("No relevant knowledge base documents found.");
  });

  it("assembles prompt context with token bounds and language rules", () => {
    const prompt = assemblePromptContext({
      instructions: "You are a customer support agent.",
      tone: "friendly",
      language: "id",
      knowledgeContext: "[Source 1: Policy]\nReturns are free within 30 days.",
      messages: [
        { sender: "customer", text: "Halo, apakah retur barang bayar?" },
        { sender: "operator", text: "Halo! Selamat datang di support." }
      ],
      maxPromptTokens: 1000
    });

    expect(prompt.systemInstructions).toContain("STRICT SAFETY RULE");
    expect(prompt.systemInstructions).toContain("Jawab dalam Bahasa Indonesia");
    expect(prompt.knowledgeContext).toContain("Returns are free within 30 days.");
    expect(prompt.formattedMessages).toContain("Customer: Halo, apakah retur barang bayar?");
    expect(prompt.tokenCountEstimate).toBeGreaterThan(0);
  });
});
