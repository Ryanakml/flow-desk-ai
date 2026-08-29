import { createHash } from "node:crypto";

export interface TextChunk {
  chunkIndex: number;
  content: string;
  contentHash: string;
  tokenCount: number;
}

export interface ChunkOptions {
  maxChunkTokens?: number; // Default 300 tokens (~1200 characters)
  overlapTokens?: number; // Default 50 tokens (~200 characters)
}

function computeSha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/**
 * Splits document text into overlapping token-bounded chunks for vector indexing.
 */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const maxChunkTokens = options.maxChunkTokens ?? 300;
  const overlapTokens = options.overlapTokens ?? 50;

  const maxChunkChars = maxChunkTokens * 4;
  const overlapChars = overlapTokens * 4;

  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  // Split into paragraph blocks
  const paragraphs = normalized.split(/\n\s*\n/);
  const chunks: TextChunk[] = [];

  let currentBuffer = "";
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    const trimmedP = paragraph.trim();
    if (!trimmedP) continue;

    if ((currentBuffer + "\n\n" + trimmedP).length <= maxChunkChars) {
      currentBuffer = currentBuffer ? currentBuffer + "\n\n" + trimmedP : trimmedP;
    } else {
      if (currentBuffer) {
        const tokenCount = Math.ceil(currentBuffer.length / 4);
        chunks.push({
          chunkIndex: chunkIndex++,
          content: currentBuffer,
          contentHash: computeSha256(currentBuffer),
          tokenCount
        });

        // Preserve overlap from the end of currentBuffer
        const overlapText = currentBuffer.slice(-overlapChars);
        currentBuffer = overlapText ? overlapText + "\n\n" + trimmedP : trimmedP;
      } else {
        // Single paragraph exceeds maxChunkChars — hard chunking
        let start = 0;
        while (start < trimmedP.length) {
          const end = Math.min(start + maxChunkChars, trimmedP.length);
          const chunkStr = trimmedP.slice(start, end);
          const tokenCount = Math.ceil(chunkStr.length / 4);

          chunks.push({
            chunkIndex: chunkIndex++,
            content: chunkStr,
            contentHash: computeSha256(chunkStr),
            tokenCount
          });

          start += maxChunkChars - overlapChars;
        }
        currentBuffer = "";
      }
    }
  }

  if (currentBuffer.trim()) {
    const tokenCount = Math.ceil(currentBuffer.length / 4);
    chunks.push({
      chunkIndex: chunkIndex++,
      content: currentBuffer.trim(),
      contentHash: computeSha256(currentBuffer.trim()),
      tokenCount
    });
  }

  return chunks;
}
