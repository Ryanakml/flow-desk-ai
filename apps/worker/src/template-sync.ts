import { computeTemplatePayloadHash, validateTemplateComponents } from "@flowdesk/domain";
import {
  type DbClient,
  getTemplateSyncCursor,
  idempotentSyncTemplate,
  setTemplateSyncCursor
} from "@flowdesk/db";
import { type WhatsAppProvider, WhatsAppProviderError } from "@flowdesk/providers";

export interface SyncWhatsAppTemplatesParams {
  organizationId: string;
  channelId: string;
  wabaId: string;
  accessToken: string;
  pageSize?: number;
  maxPages?: number;
}

export interface SyncWhatsAppTemplatesDeps {
  db: DbClient;
  provider: WhatsAppProvider;
  logger?: {
    info: (msg: string, ctx?: Record<string, unknown>) => void;
    warn: (msg: string, ctx?: Record<string, unknown>) => void;
    error: (msg: string, ctx?: Record<string, unknown>) => void;
  };
}

export interface SyncWhatsAppTemplatesResult {
  channelId: string;
  totalFetched: number;
  syncedCount: number;
  statusChangedCount: number;
  payloadChangedCount: number;
  cursor: string | null;
}

/**
 * Synchronizes message templates from the WhatsApp provider into the tenant database.
 * - Idempotently persists template versions and status history.
 * - Validates component hierarchy and variable structure before syncing.
 * - Protects against token leakage in logs and exception traces.
 */
export async function syncWhatsAppTemplates(
  params: SyncWhatsAppTemplatesParams,
  deps: SyncWhatsAppTemplatesDeps
): Promise<SyncWhatsAppTemplatesResult> {
  const { organizationId, channelId, wabaId, accessToken, pageSize = 100, maxPages = 10 } = params;
  const { db, provider, logger } = deps;

  logger?.info("Starting WhatsApp template synchronization", {
    organizationId,
    channelId,
    wabaId
  });

  let totalFetched = 0;
  let syncedCount = 0;
  let statusChangedCount = 0;
  let payloadChangedCount = 0;

  // Retrieve last saved cursor (if resuming)
  let currentCursor = await getTemplateSyncCursor(db, { channelId });
  let pageCount = 0;
  let nextAfter: string | undefined = currentCursor ?? undefined;

  try {
    while (pageCount < maxPages) {
      pageCount++;

      const fetchResult = await provider.fetchMessageTemplates({
        wabaId,
        accessToken,
        limit: pageSize,
        after: nextAfter
      });

      const templates = fetchResult.data;
      totalFetched += templates.length;

      for (const tpl of templates) {
        // Validate component structure
        const validation = validateTemplateComponents(tpl.components);
        if (!validation.valid) {
          logger?.warn("Skipping invalid WhatsApp template component structure", {
            templateId: tpl.id,
            templateName: tpl.name,
            reason: validation.error
          });
          continue;
        }

        const payloadHash = computeTemplatePayloadHash({
          category: tpl.category,
          language: tpl.language,
          components: tpl.components
        });

        const syncResult = await idempotentSyncTemplate(db, {
          organizationId,
          channelId,
          providerTemplateId: tpl.id,
          name: tpl.name,
          category: tpl.category,
          language: tpl.language,
          status: tpl.status,
          rejectedReason: tpl.rejected_reason ?? null,
          components: tpl.components,
          variableCount: validation.variableCount,
          payloadHash
        });

        syncedCount++;
        if (syncResult.statusChanged) statusChangedCount++;
        if (syncResult.payloadChanged) payloadChangedCount++;
      }

      // Check if more pages exist
      const afterCursor = fetchResult.paging?.cursors?.after;
      if (afterCursor && afterCursor !== nextAfter && fetchResult.data.length >= pageSize) {
        nextAfter = afterCursor;
        currentCursor = afterCursor;
      } else {
        // Reached the end of available templates
        break;
      }
    }

    // Save final cursor
    await setTemplateSyncCursor(db, {
      organizationId,
      channelId,
      cursor: currentCursor
    });

    logger?.info("WhatsApp template synchronization completed", {
      organizationId,
      channelId,
      totalFetched,
      syncedCount,
      statusChangedCount,
      payloadChangedCount
    });

    return {
      channelId,
      totalFetched,
      syncedCount,
      statusChangedCount,
      payloadChangedCount,
      cursor: currentCursor
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Sanitize any accidental token leakage
    const sanitizedMessage = accessToken
      ? errorMessage.replaceAll(accessToken, "[REDACTED_ACCESS_TOKEN]")
      : errorMessage;

    logger?.error("WhatsApp template synchronization failed", {
      organizationId,
      channelId,
      wabaId,
      error: sanitizedMessage
    });

    if (error instanceof WhatsAppProviderError) {
      throw new WhatsAppProviderError({
        message: sanitizedMessage,
        classification: error.classification,
        statusCode: error.statusCode,
        providerCode: error.providerCode,
        providerSubcode: error.providerSubcode
      });
    }

    throw new Error(`Template sync failed: ${sanitizedMessage}`);
  }
}
