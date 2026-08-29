export interface Citation {
  chunkId: string;
  documentTitle: string;
  snippet: string;
  score: number;
}

export interface RagRetrievalResult {
  citations: Citation[];
  contextText: string;
  hasSufficientEvidence: boolean;
  maxSimilarityScore: number;
}

export interface ConversationMessageContext {
  sender: "customer" | "operator" | "system";
  text: string;
  sentAt?: Date;
}

export interface AssembledPromptContext {
  systemInstructions: string;
  knowledgeContext: string;
  formattedMessages: string;
  tokenCountEstimate: number;
}

export interface FormatPromptParams {
  instructions: string;
  tone?: string;
  language?: string;
  knowledgeContext: string;
  messages: ConversationMessageContext[];
  maxPromptTokens?: number;
}

/**
 * Transforms raw document chunk search results into structured citations.
 */
export function buildCitations(
  chunks: Array<{
    id: string;
    content: string;
    similarity: number;
    metadata?: Record<string, unknown>;
  }>
): Citation[] {
  return chunks.map((chunk) => {
    const documentTitle =
      typeof chunk.metadata?.["documentTitle"] === "string"
        ? chunk.metadata["documentTitle"]
        : "Knowledge Document";

    // Truncate snippet to 200 characters with ellipsis
    const snippet =
      chunk.content.length > 200 ? `${chunk.content.slice(0, 197)}...` : chunk.content;

    return {
      chunkId: chunk.id,
      documentTitle,
      snippet,
      score: Number(chunk.similarity.toFixed(4))
    };
  });
}

/**
 * Formats citations into a clean, markdown-structured knowledge context block for LLM prompts.
 */
export function formatKnowledgeContext(citations: Citation[]): string {
  if (citations.length === 0) {
    return "No relevant knowledge base documents found.";
  }

  return citations
    .map(
      (c, idx) =>
        `[Source ${idx + 1}: ${c.documentTitle} (Relevance: ${Math.round(c.score * 100)}%)]\n${c.snippet}`
    )
    .join("\n\n");
}

/**
 * Assembles system instructions, retrieved knowledge context, and conversation history into a token-bounded prompt context.
 */
export function assemblePromptContext(params: FormatPromptParams): AssembledPromptContext {
  const maxTokens = params.maxPromptTokens ?? 3000;
  const tone = params.tone ?? "professional";
  const language = params.language ?? "id";

  const langInstruction =
    language === "id"
      ? "Jawab dalam Bahasa Indonesia yang santun dan profesional."
      : language === "en"
        ? "Respond in clear, professional English."
        : "Respond in the same language as the customer's query.";

  const systemInstructions = `${params.instructions.trim()}\n\nTone: ${tone}.\n${langInstruction}\n\nSTRICT SAFETY RULE: Answer ONLY based on the provided knowledge context. If the knowledge context does not contain sufficient evidence to answer, state clearly that you do not have enough information and escalate to human support. Do NOT invent facts or URLs.`;

  // Format message history (reverse to prioritize recent messages)
  const historyLines: string[] = [];
  let currentChars = systemInstructions.length + params.knowledgeContext.length;
  const maxChars = maxTokens * 4;

  const reversed = [...params.messages].reverse();
  for (const msg of reversed) {
    const roleLabel = msg.sender === "customer" ? "Customer" : "Agent";
    const line = `${roleLabel}: ${msg.text.trim()}`;

    if (currentChars + line.length > maxChars) {
      break;
    }
    historyLines.unshift(line);
    currentChars += line.length;
  }

  const formattedMessages = historyLines.join("\n");
  const fullPromptStr = `${systemInstructions}\n\nKnowledge Context:\n${params.knowledgeContext}\n\nConversation History:\n${formattedMessages}`;
  const tokenCountEstimate = Math.ceil(fullPromptStr.length / 4);

  return {
    systemInstructions,
    knowledgeContext: params.knowledgeContext,
    formattedMessages,
    tokenCountEstimate
  };
}
