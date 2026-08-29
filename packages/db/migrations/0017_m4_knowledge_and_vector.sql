-- Migration 0017: M4 Knowledge Base, pgvector Chunks, Bot Configuration, and Audit Schema
-- Adds support for tenant-isolated vector embeddings and AI draft auditing.

CREATE TABLE IF NOT EXISTS flowdesk.knowledge_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    type text NOT NULL CHECK (type IN ('text', 'file', 'url')),
    name text NOT NULL CHECK (length(trim(name)) >= 1 AND length(name) <= 200),
    source_uri text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'active', 'failed', 'archived')),
    status_reason text,
    content_hash text,
    byte_size bigint NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_indexed_at timestamptz,
    created_by_user_id uuid REFERENCES flowdesk.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS flowdesk.documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    source_id uuid NOT NULL REFERENCES flowdesk.knowledge_sources(id) ON DELETE CASCADE,
    title text NOT NULL CHECK (length(trim(title)) >= 1 AND length(title) <= 200),
    content_type text NOT NULL DEFAULT 'text/plain',
    content_hash text NOT NULL,
    raw_content text,
    token_count integer NOT NULL DEFAULT 0 CHECK (token_count >= 0),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS flowdesk.document_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    document_id uuid NOT NULL REFERENCES flowdesk.documents(id) ON DELETE CASCADE,
    source_id uuid NOT NULL REFERENCES flowdesk.knowledge_sources(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL CHECK (chunk_index >= 0),
    content text NOT NULL CHECK (length(trim(content)) > 0),
    content_hash text NOT NULL,
    embedding vector(1536),
    token_count integer NOT NULL DEFAULT 0 CHECK (token_count >= 0),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (document_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS flowdesk.knowledge_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    version_number integer NOT NULL CHECK (version_number > 0),
    title text NOT NULL CHECK (length(trim(title)) >= 1),
    snapshot_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id uuid REFERENCES flowdesk.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (organization_id, version_number)
);

CREATE TABLE IF NOT EXISTS flowdesk.bot_configs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE UNIQUE,
    mode text NOT NULL DEFAULT 'draft' CHECK (mode IN ('off', 'draft')),
    name text NOT NULL DEFAULT 'FlowDesk AI Assistant' CHECK (length(trim(name)) >= 1),
    instructions text NOT NULL DEFAULT 'You are a helpful customer support assistant. Answer accurately based on provided context.',
    tone text NOT NULL DEFAULT 'professional' CHECK (tone IN ('professional', 'friendly', 'concise', 'formal')),
    language text NOT NULL DEFAULT 'id' CHECK (language IN ('id', 'en', 'auto')),
    model text NOT NULL DEFAULT 'gpt-4o-mini',
    confidence_threshold double precision NOT NULL DEFAULT 0.7 CHECK (confidence_threshold >= 0.0 AND confidence_threshold <= 1.0),
    top_k integer NOT NULL DEFAULT 5 CHECK (top_k >= 1 AND top_k <= 20),
    emergency_disabled boolean NOT NULL DEFAULT false,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS flowdesk.bot_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES flowdesk.organizations(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL REFERENCES flowdesk.conversations(id) ON DELETE CASCADE,
    trigger_message_id uuid REFERENCES flowdesk.messages(id) ON DELETE SET NULL,
    bot_config_id uuid REFERENCES flowdesk.bot_configs(id) ON DELETE SET NULL,
    knowledge_version_id uuid REFERENCES flowdesk.knowledge_versions(id) ON DELETE SET NULL,
    mode text NOT NULL CHECK (mode IN ('off', 'draft')),
    status text NOT NULL DEFAULT 'completed' CHECK (status IN ('started', 'completed', 'failed', 'fallback_no_evidence')),
    suggested_content text,
    citations jsonb NOT NULL DEFAULT '[]'::jsonb,
    reasoning text,
    confidence double precision CHECK (confidence >= 0.0 AND confidence <= 1.0),
    prompt_tokens integer NOT NULL DEFAULT 0,
    completion_tokens integer NOT NULL DEFAULT 0,
    total_tokens integer NOT NULL DEFAULT 0,
    latency_ms integer NOT NULL DEFAULT 0,
    cost_estimate_microcents bigint NOT NULL DEFAULT 0,
    operator_action text CHECK (operator_action IN ('approved', 'edited', 'rejected', 'ignored')),
    operator_action_at timestamptz,
    operator_user_id uuid REFERENCES flowdesk.users(id) ON DELETE SET NULL,
    error_detail text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Performance & Vector Search Indexes
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_cosine
    ON flowdesk.document_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_org_status
    ON flowdesk.knowledge_sources (organization_id, status)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_org_source
    ON flowdesk.documents (organization_id, source_id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chunks_org_doc
    ON flowdesk.document_chunks (organization_id, document_id);

CREATE INDEX IF NOT EXISTS idx_bot_runs_org_conv
    ON flowdesk.bot_runs (organization_id, conversation_id, created_at DESC);

-- Enable and Force Row-Level Security
ALTER TABLE flowdesk.knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.knowledge_sources FORCE ROW LEVEL SECURITY;

ALTER TABLE flowdesk.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.documents FORCE ROW LEVEL SECURITY;

ALTER TABLE flowdesk.document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.document_chunks FORCE ROW LEVEL SECURITY;

ALTER TABLE flowdesk.knowledge_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.knowledge_versions FORCE ROW LEVEL SECURITY;

ALTER TABLE flowdesk.bot_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.bot_configs FORCE ROW LEVEL SECURITY;

ALTER TABLE flowdesk.bot_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowdesk.bot_runs FORCE ROW LEVEL SECURITY;

-- Tenant Isolation Policies
DROP POLICY IF EXISTS knowledge_sources_tenant ON flowdesk.knowledge_sources;
CREATE POLICY knowledge_sources_tenant ON flowdesk.knowledge_sources
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

DROP POLICY IF EXISTS documents_tenant ON flowdesk.documents;
CREATE POLICY documents_tenant ON flowdesk.documents
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

DROP POLICY IF EXISTS document_chunks_tenant ON flowdesk.document_chunks;
CREATE POLICY document_chunks_tenant ON flowdesk.document_chunks
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

DROP POLICY IF EXISTS knowledge_versions_tenant ON flowdesk.knowledge_versions;
CREATE POLICY knowledge_versions_tenant ON flowdesk.knowledge_versions
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

DROP POLICY IF EXISTS bot_configs_tenant ON flowdesk.bot_configs;
CREATE POLICY bot_configs_tenant ON flowdesk.bot_configs
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

DROP POLICY IF EXISTS bot_runs_tenant ON flowdesk.bot_runs;
CREATE POLICY bot_runs_tenant ON flowdesk.bot_runs
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());

-- Ownership & Permission Grants
ALTER TABLE flowdesk.knowledge_sources OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.documents OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.document_chunks OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.knowledge_versions OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.bot_configs OWNER TO flowdesk_migrator;
ALTER TABLE flowdesk.bot_runs OWNER TO flowdesk_migrator;

GRANT SELECT, INSERT, UPDATE, DELETE ON
    flowdesk.knowledge_sources,
    flowdesk.documents,
    flowdesk.document_chunks,
    flowdesk.knowledge_versions,
    flowdesk.bot_configs,
    flowdesk.bot_runs
TO flowdesk_runtime;

GRANT SELECT ON
    flowdesk.knowledge_sources,
    flowdesk.documents,
    flowdesk.document_chunks,
    flowdesk.knowledge_versions,
    flowdesk.bot_configs,
    flowdesk.bot_runs
TO flowdesk_reporting;
