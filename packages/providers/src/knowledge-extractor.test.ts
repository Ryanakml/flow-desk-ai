import { describe, it, expect } from "vitest";
import { extractKnowledgeContent } from "./knowledge-extractor.js";

describe("Knowledge Base Content Extractor", () => {
  it("extracts text and title from plain text input", () => {
    const rawText = "FlowDesk Features Guide\nFlowDesk offers multi-tenant inbox management.";
    const result = extractKnowledgeContent(rawText, "text/plain");

    expect(result.title).toBe("FlowDesk Features Guide");
    expect(result.text).toContain("FlowDesk offers multi-tenant inbox management.");
    expect(result.tokenCountEstimate).toBeGreaterThan(0);
  });

  it("extracts title from Markdown header", () => {
    const markdown =
      "# Enterprise SLA Policy\n\nAll P1 tickets must be responded to within 15 minutes.";
    const result = extractKnowledgeContent(markdown, "text/markdown");

    expect(result.title).toBe("Enterprise SLA Policy");
    expect(result.text).toContain("All P1 tickets must be responded to within 15 minutes.");
  });

  it("strips HTML tags, scripts, and styles from HTML content", () => {
    const html = `
      <html>
        <head>
          <title>Internal Guide</title>
          <style>body { color: red; }</style>
          <script>console.log('malicious');</script>
        </head>
        <body>
          <h1>Customer Refund Rules</h1>
          <p>Refunds are processed within 3 business days.</p>
        </body>
      </html>
    `;
    const result = extractKnowledgeContent(html, "text/html");

    expect(result.text).not.toContain("console.log");
    expect(result.text).not.toContain("color: red");
    expect(result.text).toContain("Customer Refund Rules");
    expect(result.text).toContain("Refunds are processed within 3 business days.");
  });

  it("throws error for empty document", () => {
    expect(() => extractKnowledgeContent("   \n\n   ", "text/plain")).toThrow(/empty/i);
  });
});
