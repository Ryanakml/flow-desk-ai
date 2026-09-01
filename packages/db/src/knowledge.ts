import type { DbClient } from "./auth.js";

export type KnowledgeSourceType = "text" | "file" | "url";
export type KnowledgeSourceStatus = "pending" | "indexing" | "active" | "failed" | "archived";
export type BotMode = "off" | "draft";
export type BotTone = "professional" | "friendly" | "concise" | "formal";
export type BotLanguage = "id" | "en" | "auto";
export type BotRunStatus =
  | "queued"
  | "processing"
  | "completed"
  | "no_evidence"
  | "safety_blocked"
  | "budget_exceeded"
  | "provider_failed"
  | "stale"
  | "cancelled"
  | "off";
export type OperatorAction = "approved" | "edited" | "rejected" | "ignored";
export type KnowledgeIngestionJobStatus = "queued" | "processing" | "completed" | "failed";

export interface KnowledgeSource {
  id: string;
  organizationId: string;
  type: KnowledgeSourceType;
  name: string;
  sourceUri: string | null;
  status: KnowledgeSourceStatus;
  statusReason: string | null;
  contentHash: string | null;
  dedupeKey: string | null;
  byteSize: number;
  metadata: Record<string, unknown>;
  lastIndexedAt: Date | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DocumentRecord {
  id: string;
  organizationId: string;
  sourceId: string;
  title: string;
  contentType: string;
  contentHash: string;
  rawContent: string | null;
  tokenCount: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DocumentChunk {
  id: string;
  organizationId: string;
  documentId: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  embedding: number[] | null;
  tokenCount: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface DocumentChunkSearchResult extends DocumentChunk {
  similarity: number;
}

export interface KnowledgeIngestionJob {
  id: string;
  organizationId: string;
  sourceId: string;
  dedupeKey: string;
  inputText: string | null;
  status: KnowledgeIngestionJobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  errorCode: string | null;
  errorDetail: string | null;
}

export interface KnowledgeVersion {
  id: string;
  organizationId: string;
  versionNumber: number;
  title: string;
  snapshotMetadata: Record<string, unknown>;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface BotConfig {
  id: string;
  organizationId: string;
  mode: BotMode;
  name: string;
  instructions: string;
  tone: BotTone;
  language: BotLanguage;
  model: string;
  confidenceThreshold: number;
  topK: number;
  emergencyDisabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface BotRun {
  id: string;
  organizationId: string;
  conversationId: string;
  triggerMessageId: string | null;
  botConfigId: string | null;
  knowledgeVersionId: string | null;
  mode: BotMode;
  status: BotRunStatus;
  suggestedContent: string | null;
  citations: Array<{ chunkId: string; sourceTitle: string; snippet: string; score: number }>;
  reasoning: string | null;
  confidence: number | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  costEstimateMicrocents: number;
  operatorAction: OperatorAction | null;
  operatorActionAt: Date | null;
  operatorUserId: string | null;
  errorDetail: string | null;
  errorCode: string | null;
  requestedByUserId: string | null;
  model: string | null;
  promptVersion: string;
  configSnapshot: Record<string, unknown>;
  inputMessageCreatedAt: Date | null;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  claimedAt: Date | null;
  completedAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ----------------------------------------------------------------------
// Knowledge Sources
// ----------------------------------------------------------------------

export async function createKnowledgeSource(
  db: DbClient,
  input: {
    organizationId: string;
    type: KnowledgeSourceType;
    name: string;
    sourceUri?: string | null;
    contentHash?: string | null;
    dedupeKey?: string | null;
    byteSize?: number;
    metadata?: Record<string, unknown>;
    createdByUserId?: string | null;
  }
): Promise<KnowledgeSource> {
  const res = await db.query<{
    id: string;
    organization_id: string;
    type: KnowledgeSourceType;
    name: string;
    source_uri: string | null;
    status: KnowledgeSourceStatus;
    status_reason: string | null;
    content_hash: string | null;
    dedupe_key: string | null;
    byte_size: string;
    metadata: Record<string, unknown>;
    last_indexed_at: Date | null;
    created_by_user_id: string | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
  }>(
    `INSERT INTO flowdesk.knowledge_sources (
      organization_id, type, name, source_uri, content_hash, dedupe_key, byte_size, metadata, created_by_user_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (organization_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL AND deleted_at IS NULL
    DO UPDATE SET updated_at = flowdesk.knowledge_sources.updated_at
    RETURNING *`,
    [
      input.organizationId,
      input.type,
      input.name,
      input.sourceUri ?? null,
      input.contentHash ?? null,
      input.dedupeKey ?? null,
      input.byteSize ?? 0,
      JSON.stringify(input.metadata ?? {}),
      input.createdByUserId ?? null
    ]
  );

  const row = res.rows[0]!;
  return {
    id: row.id,
    organizationId: row.organization_id,
    type: row.type,
    name: row.name,
    sourceUri: row.source_uri,
    status: row.status,
    statusReason: row.status_reason,
    contentHash: row.content_hash,
    dedupeKey: row.dedupe_key ?? input.dedupeKey ?? null,
    byteSize: Number(row.byte_size),
    metadata: row.metadata,
    lastIndexedAt: row.last_indexed_at,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

export async function getKnowledgeSourceById(
  db: DbClient,
  id: string
): Promise<KnowledgeSource | null> {
  const res = await db.query<{
    id: string;
    organization_id: string;
    type: KnowledgeSourceType;
    name: string;
    source_uri: string | null;
    status: KnowledgeSourceStatus;
    status_reason: string | null;
    content_hash: string | null;
    dedupe_key: string | null;
    byte_size: string;
    metadata: Record<string, unknown>;
    last_indexed_at: Date | null;
    created_by_user_id: string | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
  }>(
    `SELECT * FROM flowdesk.knowledge_sources
     WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );

  if (res.rows.length === 0) return null;
  const row = res.rows[0]!;
  return {
    id: row.id,
    organizationId: row.organization_id,
    type: row.type,
    name: row.name,
    sourceUri: row.source_uri,
    status: row.status,
    statusReason: row.status_reason,
    contentHash: row.content_hash,
    dedupeKey: row.dedupe_key ?? null,
    byteSize: Number(row.byte_size),
    metadata: row.metadata,
    lastIndexedAt: row.last_indexed_at,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

export async function listKnowledgeSources(
  db: DbClient,
  organizationId: string
): Promise<KnowledgeSource[]> {
  const res = await db.query<{
    id: string;
    organization_id: string;
    type: KnowledgeSourceType;
    name: string;
    source_uri: string | null;
    status: KnowledgeSourceStatus;
    status_reason: string | null;
    content_hash: string | null;
    dedupe_key: string | null;
    byte_size: string;
    metadata: Record<string, unknown>;
    last_indexed_at: Date | null;
    created_by_user_id: string | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
  }>(
    `SELECT * FROM flowdesk.knowledge_sources
     WHERE organization_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [organizationId]
  );

  return res.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    type: row.type,
    name: row.name,
    sourceUri: row.source_uri,
    status: row.status,
    statusReason: row.status_reason,
    contentHash: row.content_hash,
    dedupeKey: row.dedupe_key ?? null,
    byteSize: Number(row.byte_size),
    metadata: row.metadata,
    lastIndexedAt: row.last_indexed_at,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  }));
}

export async function updateKnowledgeSourceStatus(
  db: DbClient,
  id: string,
  status: KnowledgeSourceStatus,
  statusReason?: string | null
): Promise<void> {
  await db.query(
    `UPDATE flowdesk.knowledge_sources
     SET status = $1, status_reason = $2, updated_at = clock_timestamp(),
         last_indexed_at = CASE WHEN $1 = 'active' THEN clock_timestamp() ELSE last_indexed_at END
     WHERE id = $3`,
    [status, statusReason ?? null, id]
  );
}

export async function enqueueKnowledgeIngestionJob(
  db: DbClient,
  input: {
    organizationId: string;
    sourceId: string;
    dedupeKey: string;
    inputText?: string | null;
  }
): Promise<KnowledgeIngestionJob> {
  const res = await db.query<{
    id: string;
    organization_id: string;
    source_id: string;
    dedupe_key: string;
    input_text: string | null;
    status: KnowledgeIngestionJobStatus;
    attempts: number;
    max_attempts: number;
    available_at: Date;
    error_code: string | null;
    error_detail: string | null;
  }>(
    `INSERT INTO flowdesk.knowledge_ingestion_jobs (
       organization_id, source_id, dedupe_key, input_text
     ) VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, dedupe_key) DO UPDATE
       SET status = CASE
             WHEN flowdesk.knowledge_ingestion_jobs.status = 'failed' THEN 'queued'
             ELSE flowdesk.knowledge_ingestion_jobs.status
           END,
           attempts = CASE
             WHEN flowdesk.knowledge_ingestion_jobs.status = 'failed' THEN 0
             ELSE flowdesk.knowledge_ingestion_jobs.attempts
           END,
           available_at = CASE
             WHEN flowdesk.knowledge_ingestion_jobs.status = 'failed' THEN clock_timestamp()
             ELSE flowdesk.knowledge_ingestion_jobs.available_at
           END,
           error_code = CASE
             WHEN flowdesk.knowledge_ingestion_jobs.status = 'failed' THEN NULL
             ELSE flowdesk.knowledge_ingestion_jobs.error_code
           END,
           error_detail = CASE
             WHEN flowdesk.knowledge_ingestion_jobs.status = 'failed' THEN NULL
             ELSE flowdesk.knowledge_ingestion_jobs.error_detail
           END,
           updated_at = clock_timestamp()
     RETURNING id, organization_id, source_id, dedupe_key, input_text, status,
               attempts, max_attempts, available_at, error_code, error_detail`,
    [input.organizationId, input.sourceId, input.dedupeKey, input.inputText ?? null]
  );
  return mapKnowledgeIngestionJob(res.rows[0]!);
}

export async function claimKnowledgeIngestionJobs(
  db: DbClient,
  limit = 10
): Promise<
  Array<{
    id: string;
    organizationId: string;
    sourceId: string;
    attempts: number;
    maxAttempts: number;
  }>
> {
  const res = await db.query<{
    id: string;
    organization_id: string;
    source_id: string;
    attempts: number;
    max_attempts: number;
  }>(`SELECT * FROM flowdesk.claim_knowledge_ingestion_jobs($1::integer)`, [limit]);
  return res.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    sourceId: row.source_id,
    attempts: row.attempts,
    maxAttempts: row.max_attempts
  }));
}

export async function getKnowledgeIngestionJob(
  db: DbClient,
  id: string
): Promise<KnowledgeIngestionJob | null> {
  const res = await db.query<{
    id: string;
    organization_id: string;
    source_id: string;
    dedupe_key: string;
    input_text: string | null;
    status: KnowledgeIngestionJobStatus;
    attempts: number;
    max_attempts: number;
    available_at: Date;
    error_code: string | null;
    error_detail: string | null;
  }>(
    `SELECT id, organization_id, source_id, dedupe_key, input_text, status,
            attempts, max_attempts, available_at, error_code, error_detail
     FROM flowdesk.knowledge_ingestion_jobs WHERE id = $1`,
    [id]
  );
  return res.rows[0] ? mapKnowledgeIngestionJob(res.rows[0]) : null;
}

export async function updateKnowledgeIngestionJob(
  db: DbClient,
  input: {
    id: string;
    status: "queued" | "completed" | "failed";
    availableAt?: Date;
    errorCode?: string | null;
    errorDetail?: string | null;
  }
): Promise<void> {
  await db.query(
    `UPDATE flowdesk.knowledge_ingestion_jobs
     SET status = $2,
         input_text = CASE WHEN $2 = 'completed' THEN NULL ELSE input_text END,
         available_at = COALESCE($3, available_at),
         error_code = $4,
         error_detail = $5,
         completed_at = CASE WHEN $2 IN ('completed', 'failed') THEN clock_timestamp() ELSE NULL END,
         updated_at = clock_timestamp()
     WHERE id = $1`,
    [
      input.id,
      input.status,
      input.availableAt ?? null,
      input.errorCode ?? null,
      input.errorDetail ?? null
    ]
  );
}

export async function replaceKnowledgeSourceDocument(
  db: DbClient,
  input: Parameters<typeof createDocumentWithChunks>[1]
): Promise<{ documentId: string; chunkCount: number }> {
  await db.query(`DELETE FROM flowdesk.documents WHERE source_id = $1`, [input.sourceId]);
  return createDocumentWithChunks(db, input);
}

export async function completeKnowledgeSourceIngestion(
  db: DbClient,
  input: { organizationId: string; sourceId: string; contentHash: string; byteSize: number }
): Promise<void> {
  await db.query(
    `UPDATE flowdesk.knowledge_sources
     SET status = 'active', status_reason = NULL, content_hash = $2, byte_size = $3,
         last_indexed_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE id = $1`,
    [input.sourceId, input.contentHash, input.byteSize]
  );
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [
    input.organizationId
  ]);
  await db.query(
    `INSERT INTO flowdesk.knowledge_versions (
       organization_id, version_number, title, snapshot_metadata
     )
     SELECT $1,
            COALESCE(MAX(version_number), 0) + 1,
            'Knowledge snapshot',
            jsonb_build_object(
              'activeSourceCount', (
                SELECT COUNT(*) FROM flowdesk.knowledge_sources
                WHERE organization_id = $1 AND status = 'active' AND deleted_at IS NULL
              ),
              'activeSourceIds', (
                SELECT COALESCE(jsonb_agg(id ORDER BY id), '[]'::jsonb)
                FROM flowdesk.knowledge_sources
                WHERE organization_id = $1 AND status = 'active' AND deleted_at IS NULL
              )
            )
     FROM flowdesk.knowledge_versions
     WHERE organization_id = $1`,
    [input.organizationId]
  );
}

export async function getLatestKnowledgeVersion(
  db: DbClient,
  organizationId: string
): Promise<KnowledgeVersion | null> {
  const result = await db.query<{
    id: string;
    organization_id: string;
    version_number: number;
    title: string;
    snapshot_metadata: Record<string, unknown>;
    created_by_user_id: string | null;
    created_at: Date;
  }>(
    `SELECT * FROM flowdesk.knowledge_versions
     WHERE organization_id = $1
     ORDER BY version_number DESC
     LIMIT 1`,
    [organizationId]
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        organizationId: row.organization_id,
        versionNumber: row.version_number,
        title: row.title,
        snapshotMetadata: row.snapshot_metadata,
        createdByUserId: row.created_by_user_id,
        createdAt: row.created_at
      }
    : null;
}

function mapKnowledgeIngestionJob(row: {
  id: string;
  organization_id: string;
  source_id: string;
  dedupe_key: string;
  input_text: string | null;
  status: KnowledgeIngestionJobStatus;
  attempts: number;
  max_attempts: number;
  available_at: Date;
  error_code: string | null;
  error_detail: string | null;
}): KnowledgeIngestionJob {
  return {
    id: row.id,
    organizationId: row.organization_id,
    sourceId: row.source_id,
    dedupeKey: row.dedupe_key,
    inputText: row.input_text,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    errorCode: row.error_code,
    errorDetail: row.error_detail
  };
}

// ----------------------------------------------------------------------
// Documents & Chunks
// ----------------------------------------------------------------------

export async function createDocumentWithChunks(
  db: DbClient,
  input: {
    organizationId: string;
    sourceId: string;
    title: string;
    contentType?: string;
    contentHash: string;
    rawContent?: string | null;
    tokenCount?: number;
    metadata?: Record<string, unknown>;
    chunks: Array<{
      chunkIndex: number;
      content: string;
      contentHash: string;
      embedding?: number[] | null;
      tokenCount?: number;
      metadata?: Record<string, unknown>;
    }>;
  }
): Promise<{ documentId: string; chunkCount: number }> {
  const docRes = await db.query<{ id: string }>(
    `INSERT INTO flowdesk.documents (
      organization_id, source_id, title, content_type, content_hash, raw_content, token_count, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id`,
    [
      input.organizationId,
      input.sourceId,
      input.title,
      input.contentType ?? "text/plain",
      input.contentHash,
      input.rawContent ?? null,
      input.tokenCount ?? 0,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  const documentId = docRes.rows[0]!.id;

  for (const chunk of input.chunks) {
    const embeddingStr = chunk.embedding ? `[${chunk.embedding.join(",")}]` : null;
    await db.query(
      `INSERT INTO flowdesk.document_chunks (
        organization_id, document_id, source_id, chunk_index, content, content_hash, embedding, token_count, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, $9)`,
      [
        input.organizationId,
        documentId,
        input.sourceId,
        chunk.chunkIndex,
        chunk.content,
        chunk.contentHash,
        embeddingStr,
        chunk.tokenCount ?? 0,
        JSON.stringify(chunk.metadata ?? {})
      ]
    );
  }

  return { documentId, chunkCount: input.chunks.length };
}

export async function searchDocumentChunks(
  db: DbClient,
  input: {
    organizationId: string;
    queryEmbedding: number[];
    topK?: number;
    similarityThreshold?: number;
  }
): Promise<DocumentChunkSearchResult[]> {
  const topK = input.topK ?? 5;
  const similarityThreshold = input.similarityThreshold ?? 0.6;
  const embeddingStr = `[${input.queryEmbedding.join(",")}]`;

  // Cosine similarity = 1 - cosine distance (chunk.embedding <=> queryEmbedding)
  const res = await db.query<{
    id: string;
    organization_id: string;
    document_id: string;
    source_id: string;
    chunk_index: number;
    content: string;
    content_hash: string;
    token_count: number;
    metadata: Record<string, unknown>;
    created_at: Date;
    similarity: number;
  }>(
    `SELECT
      id, organization_id, document_id, source_id, chunk_index, content, content_hash,
      token_count, metadata, created_at,
      (1 - (embedding <=> $1::vector)) AS similarity
     FROM flowdesk.document_chunks
     WHERE organization_id = $2
       AND embedding IS NOT NULL
       AND (1 - (embedding <=> $1::vector)) >= $3
     ORDER BY embedding <=> $1::vector ASC
     LIMIT $4`,
    [embeddingStr, input.organizationId, similarityThreshold, topK]
  );

  return res.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    documentId: row.document_id,
    sourceId: row.source_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    contentHash: row.content_hash,
    embedding: null,
    tokenCount: row.token_count,
    metadata: row.metadata,
    createdAt: row.created_at,
    similarity: Number(row.similarity)
  }));
}

// ----------------------------------------------------------------------
// Bot Configurations & Runs
// ----------------------------------------------------------------------

export async function getBotConfig(
  db: DbClient,
  organizationId: string,
  options?: { forShare?: boolean }
): Promise<BotConfig | null> {
  const res = await db.query<{
    id: string;
    organization_id: string;
    mode: BotMode;
    name: string;
    instructions: string;
    tone: BotTone;
    language: BotLanguage;
    model: string;
    confidence_threshold: number;
    top_k: number;
    emergency_disabled: boolean;
    metadata: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT * FROM flowdesk.bot_configs
     WHERE organization_id = $1
     ${options?.forShare ? "FOR SHARE" : ""}`,
    [organizationId]
  );

  if (res.rows.length === 0) return null;
  const row = res.rows[0]!;
  return {
    id: row.id,
    organizationId: row.organization_id,
    mode: row.mode,
    name: row.name,
    instructions: row.instructions,
    tone: row.tone,
    language: row.language,
    model: row.model,
    confidenceThreshold: Number(row.confidence_threshold),
    topK: row.top_k,
    emergencyDisabled: row.emergency_disabled,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function upsertBotConfig(
  db: DbClient,
  input: {
    organizationId: string;
    mode?: BotMode;
    name?: string;
    instructions?: string;
    tone?: BotTone;
    language?: BotLanguage;
    model?: string;
    confidenceThreshold?: number;
    topK?: number;
    emergencyDisabled?: boolean;
    metadata?: Record<string, unknown>;
  }
): Promise<BotConfig> {
  const res = await db.query<{
    id: string;
    organization_id: string;
    mode: BotMode;
    name: string;
    instructions: string;
    tone: BotTone;
    language: BotLanguage;
    model: string;
    confidence_threshold: number;
    top_k: number;
    emergency_disabled: boolean;
    metadata: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO flowdesk.bot_configs (
      organization_id, mode, name, instructions, tone, language, model,
      confidence_threshold, top_k, emergency_disabled, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (organization_id) DO UPDATE SET
      mode = COALESCE(EXCLUDED.mode, flowdesk.bot_configs.mode),
      name = COALESCE(EXCLUDED.name, flowdesk.bot_configs.name),
      instructions = COALESCE(EXCLUDED.instructions, flowdesk.bot_configs.instructions),
      tone = COALESCE(EXCLUDED.tone, flowdesk.bot_configs.tone),
      language = COALESCE(EXCLUDED.language, flowdesk.bot_configs.language),
      model = COALESCE(EXCLUDED.model, flowdesk.bot_configs.model),
      confidence_threshold = COALESCE(EXCLUDED.confidence_threshold, flowdesk.bot_configs.confidence_threshold),
      top_k = COALESCE(EXCLUDED.top_k, flowdesk.bot_configs.top_k),
      emergency_disabled = COALESCE(EXCLUDED.emergency_disabled, flowdesk.bot_configs.emergency_disabled),
      metadata = COALESCE(EXCLUDED.metadata, flowdesk.bot_configs.metadata),
      updated_at = clock_timestamp()
    RETURNING *`,
    [
      input.organizationId,
      input.mode ?? "draft",
      input.name ?? "FlowDesk AI Assistant",
      input.instructions ??
        "You are a helpful customer support assistant. Answer accurately based on provided context.",
      input.tone ?? "professional",
      input.language ?? "id",
      input.model ?? "gpt-4o-mini",
      input.confidenceThreshold ?? 0.7,
      input.topK ?? 5,
      input.emergencyDisabled ?? false,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  const row = res.rows[0]!;
  return {
    id: row.id,
    organizationId: row.organization_id,
    mode: row.mode,
    name: row.name,
    instructions: row.instructions,
    tone: row.tone,
    language: row.language,
    model: row.model,
    confidenceThreshold: Number(row.confidence_threshold),
    topK: row.top_k,
    emergencyDisabled: row.emergency_disabled,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function recordBotRun(
  db: DbClient,
  input: {
    organizationId: string;
    conversationId: string;
    triggerMessageId?: string | null;
    botConfigId?: string | null;
    knowledgeVersionId?: string | null;
    mode: BotMode;
    status: BotRunStatus;
    suggestedContent?: string | null;
    citations?: Array<{ chunkId: string; sourceTitle: string; snippet: string; score: number }>;
    reasoning?: string | null;
    confidence?: number | null;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    latencyMs?: number;
    costEstimateMicrocents?: number;
    requestedByUserId?: string | null;
    model?: string | null;
    promptVersion?: string;
    configSnapshot?: Record<string, unknown>;
    inputMessageCreatedAt?: Date | null;
    metadata?: Record<string, unknown>;
  }
): Promise<BotRun> {
  const res = await db.query<BotRunRow>(
    `INSERT INTO flowdesk.bot_runs (
      organization_id, conversation_id, trigger_message_id, bot_config_id, knowledge_version_id,
      mode, status, suggested_content, citations, reasoning, confidence,
      prompt_tokens, completion_tokens, total_tokens, latency_ms, cost_estimate_microcents,
      requested_by_user_id, model, prompt_version, config_snapshot,
      input_message_created_at, metadata, completed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
              $15, $16, $17, $18, $19, $20, $21, $22,
              CASE WHEN $7 IN ('queued', 'processing') THEN NULL ELSE clock_timestamp() END)
    RETURNING *`,
    [
      input.organizationId,
      input.conversationId,
      input.triggerMessageId ?? null,
      input.botConfigId ?? null,
      input.knowledgeVersionId ?? null,
      input.mode,
      input.status,
      input.suggestedContent ?? null,
      JSON.stringify(input.citations ?? []),
      input.reasoning ?? null,
      input.confidence ?? null,
      input.promptTokens ?? 0,
      input.completionTokens ?? 0,
      input.totalTokens ?? 0,
      input.latencyMs ?? 0,
      input.costEstimateMicrocents ?? 0,
      input.requestedByUserId ?? null,
      input.model ?? null,
      input.promptVersion ?? "m4-v1",
      JSON.stringify(input.configSnapshot ?? {}),
      input.inputMessageCreatedAt ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
  return mapBotRun(res.rows[0]!);
}

interface BotRunRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  trigger_message_id: string | null;
  bot_config_id: string | null;
  knowledge_version_id: string | null;
  mode: BotMode;
  status: BotRunStatus;
  suggested_content: string | null;
  citations: Array<{ chunkId: string; sourceTitle: string; snippet: string; score: number }>;
  reasoning: string | null;
  confidence: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  cost_estimate_microcents: string | number;
  operator_action: OperatorAction | null;
  operator_action_at: Date | null;
  operator_user_id: string | null;
  error_code: string | null;
  error_detail: string | null;
  requested_by_user_id: string | null;
  model: string | null;
  prompt_version: string;
  config_snapshot: Record<string, unknown>;
  input_message_created_at: Date | null;
  attempts: number;
  max_attempts: number;
  available_at: Date;
  claimed_at: Date | null;
  completed_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

function mapBotRun(row: BotRunRow): BotRun {
  return {
    id: row.id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    triggerMessageId: row.trigger_message_id,
    botConfigId: row.bot_config_id,
    knowledgeVersionId: row.knowledge_version_id,
    mode: row.mode,
    status: row.status,
    suggestedContent: row.suggested_content,
    citations: row.citations ?? [],
    reasoning: row.reasoning,
    confidence:
      row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    promptTokens: row.prompt_tokens ?? 0,
    completionTokens: row.completion_tokens ?? 0,
    totalTokens: row.total_tokens ?? 0,
    latencyMs: row.latency_ms ?? 0,
    costEstimateMicrocents: Number(row.cost_estimate_microcents ?? 0),
    operatorAction: row.operator_action ?? null,
    operatorActionAt: row.operator_action_at ?? null,
    operatorUserId: row.operator_user_id ?? null,
    errorCode: row.error_code ?? null,
    errorDetail: row.error_detail ?? null,
    requestedByUserId: row.requested_by_user_id ?? null,
    model: row.model ?? null,
    promptVersion: row.prompt_version ?? "m4-v1",
    configSnapshot: row.config_snapshot ?? {},
    inputMessageCreatedAt: row.input_message_created_at ?? null,
    attempts: row.attempts ?? 0,
    maxAttempts: row.max_attempts ?? 3,
    availableAt: row.available_at ?? row.created_at,
    claimedAt: row.claimed_at ?? null,
    completedAt: row.completed_at ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at
  };
}

export async function enqueueBotDraftRun(
  db: DbClient,
  input: {
    organizationId: string;
    conversationId: string;
    triggerMessageId: string;
    botConfigId: string;
    knowledgeVersionId: string | null;
    requestedByUserId: string | null;
    model: string;
    configSnapshot: Record<string, unknown>;
    inputMessageCreatedAt: Date;
  }
): Promise<BotRun> {
  const result = await db.query<BotRunRow>(
    `INSERT INTO flowdesk.bot_runs (
       organization_id, conversation_id, trigger_message_id, bot_config_id,
       knowledge_version_id, mode, status, requested_by_user_id, model,
       prompt_version, config_snapshot, input_message_created_at
     ) VALUES ($1, $2, $3, $4, $5, 'draft', 'queued', $6, $7, 'm4-v1', $8, $9)
     ON CONFLICT (organization_id, conversation_id, trigger_message_id)
       WHERE trigger_message_id IS NOT NULL AND status IN ('queued', 'processing')
     DO UPDATE SET updated_at = flowdesk.bot_runs.updated_at
     RETURNING *`,
    [
      input.organizationId,
      input.conversationId,
      input.triggerMessageId,
      input.botConfigId,
      input.knowledgeVersionId,
      input.requestedByUserId,
      input.model,
      JSON.stringify(input.configSnapshot),
      input.inputMessageCreatedAt
    ]
  );
  return mapBotRun(result.rows[0]!);
}

export async function getBotRunById(db: DbClient, id: string): Promise<BotRun | null> {
  const result = await db.query<BotRunRow>(`SELECT * FROM flowdesk.bot_runs WHERE id = $1`, [id]);
  return result.rows[0] ? mapBotRun(result.rows[0]) : null;
}

export async function getLatestBotRunForConversation(
  db: DbClient,
  organizationId: string,
  conversationId: string
): Promise<BotRun | null> {
  const result = await db.query<BotRunRow>(
    `SELECT * FROM flowdesk.bot_runs
     WHERE organization_id = $1 AND conversation_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [organizationId, conversationId]
  );
  return result.rows[0] ? mapBotRun(result.rows[0]) : null;
}

export async function claimBotDraftRuns(
  db: DbClient,
  limit = 10
): Promise<
  Array<{
    id: string;
    organizationId: string;
    conversationId: string;
    attempts: number;
    maxAttempts: number;
  }>
> {
  const result = await db.query<{
    id: string;
    organization_id: string;
    conversation_id: string;
    attempts: number;
    max_attempts: number;
  }>(`SELECT * FROM flowdesk.claim_bot_draft_runs($1::integer)`, [limit]);
  return result.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    attempts: row.attempts,
    maxAttempts: row.max_attempts
  }));
}

export async function finishBotDraftRun(
  db: DbClient,
  input: {
    id: string;
    status: Exclude<BotRunStatus, "queued" | "processing">;
    suggestedContent?: string | null;
    citations?: Array<{ chunkId: string; sourceTitle: string; snippet: string; score: number }>;
    reasoning?: string | null;
    confidence?: number | null;
    promptTokens?: number;
    completionTokens?: number;
    latencyMs?: number;
    costEstimateMicrocents?: number;
    errorCode?: string | null;
    errorDetail?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.query(
    `UPDATE flowdesk.bot_runs
     SET status = $2, suggested_content = $3, citations = $4, reasoning = $5,
         confidence = $6, prompt_tokens = $7, completion_tokens = $8,
         total_tokens = $7 + $8, latency_ms = $9, cost_estimate_microcents = $10,
         error_code = $11, error_detail = $12, metadata = metadata || $13::jsonb,
         completed_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE id = $1 AND status IN ('queued', 'processing')`,
    [
      input.id,
      input.status,
      input.suggestedContent ?? null,
      JSON.stringify(input.citations ?? []),
      input.reasoning ?? null,
      input.confidence ?? null,
      input.promptTokens ?? 0,
      input.completionTokens ?? 0,
      input.latencyMs ?? 0,
      input.costEstimateMicrocents ?? 0,
      input.errorCode ?? null,
      input.errorDetail ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

export async function requeueBotDraftRun(
  db: DbClient,
  input: { id: string; availableAt: Date; errorCode: string; errorDetail: string }
): Promise<void> {
  await db.query(
    `UPDATE flowdesk.bot_runs
     SET status = 'queued', available_at = $2, claimed_at = NULL,
         error_code = $3, error_detail = $4, updated_at = clock_timestamp()
     WHERE id = $1 AND status = 'processing'`,
    [input.id, input.availableAt, input.errorCode, input.errorDetail]
  );
}

export async function markBotRunStale(db: DbClient, id: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE flowdesk.bot_runs
     SET status = 'stale', error_code = 'NEWER_CUSTOMER_MESSAGE',
         error_detail = 'A newer customer message arrived before this draft was used.',
         completed_at = COALESCE(completed_at, clock_timestamp()),
         updated_at = clock_timestamp()
     WHERE id = $1 AND status IN ('queued', 'processing', 'completed')
       AND operator_action IS NULL
     RETURNING id`,
    [id]
  );
  return Boolean(result.rows[0]);
}

export async function updateBotRunAction(
  db: DbClient,
  input: {
    botRunId: string;
    action: OperatorAction;
    userId?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<boolean> {
  const result = await db.query(
    `UPDATE flowdesk.bot_runs
     SET operator_action = $1, operator_action_at = clock_timestamp(), operator_user_id = $2,
         metadata = metadata || $4::jsonb,
         updated_at = clock_timestamp()
     WHERE id = $3 AND status = 'completed' AND operator_action IS NULL
     RETURNING id`,
    [input.action, input.userId ?? null, input.botRunId, JSON.stringify(input.metadata ?? {})]
  );
  return Boolean(result.rows[0]);
}
