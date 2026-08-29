export interface ExtractedKnowledgeDocument {
  title: string;
  text: string;
  tokenCountEstimate: number;
  metadata: Record<string, unknown>;
}

export interface ExtractKnowledgeOptions {
  fileName?: string;
  defaultTitle?: string;
}

/**
 * Extracts and cleans text content from raw file buffers or strings for knowledge base indexing.
 */
export function extractKnowledgeContent(
  input: Buffer | string,
  contentType: string,
  options: ExtractKnowledgeOptions = {}
): ExtractedKnowledgeDocument {
  let rawText = typeof input === "string" ? input : input.toString("utf-8");

  const normalizedContentType = contentType.toLowerCase().split(";")[0]?.trim() || "text/plain";

  // HTML sanitization: strip script, style, and HTML tags
  if (
    normalizedContentType === "text/html" ||
    rawText.includes("<html>") ||
    rawText.includes("<body")
  ) {
    rawText = rawText
      .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, "")
      .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&");
  }

  // Normalize excessive whitespace and line breaks
  const cleanedText = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");

  if (!cleanedText) {
    throw new Error("Extracted document content is empty or contains no readable text.");
  }

  // Determine document title from first header/line or options
  const firstLine = cleanedText.split("\n")[0] || "";
  const headerMatch = firstLine.match(/^#+\s*(.+)$/);
  const derivedTitle = headerMatch
    ? headerMatch[1]!.trim()
    : firstLine.length > 0 && firstLine.length <= 100
      ? firstLine
      : options.fileName || options.defaultTitle || "Untitled Document";

  // Rough estimation: 1 token ~ 4 characters
  const tokenCountEstimate = Math.ceil(cleanedText.length / 4);

  return {
    title: derivedTitle,
    text: cleanedText,
    tokenCountEstimate,
    metadata: {
      contentType: normalizedContentType,
      charCount: cleanedText.length,
      lineCount: cleanedText.split("\n").length
    }
  };
}
