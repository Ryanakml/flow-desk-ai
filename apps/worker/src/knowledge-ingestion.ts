import { createHash } from "node:crypto";
import {
  claimKnowledgeIngestionJobs,
  completeKnowledgeSourceIngestion,
  getKnowledgeIngestionJob,
  getKnowledgeSourceById,
  replaceKnowledgeSourceDocument,
  runInTenantTransaction,
  updateKnowledgeIngestionJob,
  updateKnowledgeSourceStatus,
  type DbClient
} from "@flowdesk/db";
import {
  AiProviderError,
  chunkText,
  extractKnowledgeContent,
  type AiEmbeddingProvider
} from "@flowdesk/providers";
import { fetchWithAntiSsrf, SsrfProtectionError } from "@flowdesk/security";

const ALLOWED_CONTENT_TYPES = new Set([
  "text/plain",
  "text/html",
  "application/xhtml+xml",
  "application/json"
]);

export interface KnowledgeIngestionOptions {
  embeddingProvider: AiEmbeddingProvider;
  fetcher?: typeof fetch;
  maxFetchBytes?: number;
  fetchTimeoutMs?: number;
}

function safeFailure(error: unknown): { code: string; detail: string; retryable: boolean } {
  if (error instanceof AiProviderError) {
    return { code: error.code, detail: error.message, retryable: error.retryable };
  }
  if (error instanceof SsrfProtectionError) {
    return {
      code: error.code,
      detail: "The public knowledge URL could not be ingested safely.",
      retryable: ["FETCH_TIMEOUT", "FETCH_FAILED", "HTTP_5XX"].includes(error.code)
    };
  }
  if (error instanceof Error && error.message === "UNSUPPORTED_KNOWLEDGE_CONTENT_TYPE") {
    return {
      code: "UNSUPPORTED_CONTENT_TYPE",
      detail: "The URL did not return a supported text content type.",
      retryable: false
    };
  }
  return {
    code: "KNOWLEDGE_INGESTION_FAILED",
    detail: "Knowledge ingestion failed.",
    retryable: false
  };
}

async function generateEmbeddingsInBatches(
  provider: AiEmbeddingProvider,
  content: string[]
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let index = 0; index < content.length; index += 64) {
    const batch = content.slice(index, index + 64);
    const generated = await provider.generateEmbeddings(batch);
    vectors.push(...generated.map((item) => item.embedding));
  }
  return vectors;
}

export async function processKnowledgeIngestionBatch(
  db: DbClient,
  options: KnowledgeIngestionOptions,
  limit = 5
): Promise<number> {
  const jobs = await claimKnowledgeIngestionJobs(db, limit);

  for (const claimed of jobs) {
    try {
      await runInTenantTransaction(
        db,
        { organizationId: claimed.organizationId },
        async (tenantDb) => {
          const [job, source] = await Promise.all([
            getKnowledgeIngestionJob(tenantDb, claimed.id),
            getKnowledgeSourceById(tenantDb, claimed.sourceId)
          ]);
          if (!job || !source) throw new Error("KNOWLEDGE_JOB_NOT_FOUND");

          await updateKnowledgeSourceStatus(tenantDb, source.id, "indexing");

          let rawContent: string;
          let contentType: string;
          let byteSize: number;
          let finalUrl: string | undefined;

          if (source.type === "text") {
            if (!job.inputText) throw new Error("KNOWLEDGE_TEXT_MISSING");
            rawContent = job.inputText;
            contentType = "text/plain";
            byteSize = Buffer.byteLength(rawContent, "utf8");
          } else if (source.type === "url" && source.sourceUri) {
            const fetched = await fetchWithAntiSsrf(source.sourceUri, {
              maxSizeBytes: options.maxFetchBytes ?? 2 * 1024 * 1024,
              timeoutMs: options.fetchTimeoutMs ?? 10_000,
              ...(options.fetcher ? { customFetcher: options.fetcher } : {})
            });
            const normalizedContentType = fetched.contentType.split(";")[0]?.trim().toLowerCase();
            if (!normalizedContentType || !ALLOWED_CONTENT_TYPES.has(normalizedContentType)) {
              throw new Error("UNSUPPORTED_KNOWLEDGE_CONTENT_TYPE");
            }
            rawContent = fetched.content;
            contentType = normalizedContentType;
            byteSize = fetched.byteSize;
            finalUrl = fetched.finalUrl;
          } else {
            throw new Error("UNSUPPORTED_KNOWLEDGE_SOURCE");
          }

          const extracted = extractKnowledgeContent(rawContent, contentType, {
            defaultTitle: source.name
          });
          const chunks = chunkText(extracted.text, { maxChunkTokens: 300, overlapTokens: 50 });
          if (chunks.length === 0) throw new Error("KNOWLEDGE_CONTENT_EMPTY");
          const vectors = await generateEmbeddingsInBatches(
            options.embeddingProvider,
            chunks.map((chunk) => chunk.content)
          );
          if (vectors.length !== chunks.length) throw new Error("EMBEDDING_COUNT_MISMATCH");

          const contentHash = createHash("sha256").update(extracted.text, "utf8").digest("hex");
          await replaceKnowledgeSourceDocument(tenantDb, {
            organizationId: claimed.organizationId,
            sourceId: source.id,
            title: source.name || extracted.title,
            contentType,
            contentHash,
            rawContent: extracted.text,
            tokenCount: extracted.tokenCountEstimate,
            metadata: { ...extracted.metadata, ...(finalUrl ? { finalUrl } : {}) },
            chunks: chunks.map((chunk, index) => ({
              ...chunk,
              embedding: vectors[index]!,
              metadata: { sourceName: source.name }
            }))
          });
          await completeKnowledgeSourceIngestion(tenantDb, {
            organizationId: claimed.organizationId,
            sourceId: source.id,
            contentHash,
            byteSize
          });
          await updateKnowledgeIngestionJob(tenantDb, { id: job.id, status: "completed" });
        }
      );
    } catch (error) {
      const failure = safeFailure(error);
      const willRetry = failure.retryable && claimed.attempts < claimed.maxAttempts;
      await runInTenantTransaction(
        db,
        { organizationId: claimed.organizationId },
        async (tenantDb) => {
          await updateKnowledgeIngestionJob(tenantDb, {
            id: claimed.id,
            status: willRetry ? "queued" : "failed",
            ...(willRetry
              ? {
                  availableAt: new Date(
                    Date.now() + Math.min(60_000, 2 ** claimed.attempts * 1_000)
                  )
                }
              : {}),
            errorCode: failure.code,
            errorDetail: failure.detail
          });
          await updateKnowledgeSourceStatus(
            tenantDb,
            claimed.sourceId,
            willRetry ? "pending" : "failed",
            willRetry ? "Retry scheduled after a transient ingestion failure." : failure.detail
          );
        }
      );
    }
  }

  return jobs.length;
}
