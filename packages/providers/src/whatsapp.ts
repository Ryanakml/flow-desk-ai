export type WhatsAppErrorClassification =
  | "AUTH_FAILED"
  | "RATE_LIMIT_EXCEEDED"
  | "USER_NOT_OPTED_IN"
  | "OUTSIDE_WINDOW"
  | "TRANSIENT"
  | "INVALID_PAYLOAD";

export class WhatsAppProviderError extends Error {
  readonly classification: WhatsAppErrorClassification;
  readonly isTransient: boolean;
  readonly statusCode: number;
  readonly providerCode?: number | undefined;
  readonly providerSubcode?: number | undefined;

  constructor(params: {
    message: string;
    classification: WhatsAppErrorClassification;
    statusCode: number;
    providerCode?: number | undefined;
    providerSubcode?: number | undefined;
  }) {
    super(params.message);
    this.name = "WhatsAppProviderError";
    this.classification = params.classification;
    this.statusCode = params.statusCode;
    this.providerCode = params.providerCode;
    this.providerSubcode = params.providerSubcode;
    this.isTransient =
      params.classification === "TRANSIENT" || params.classification === "RATE_LIMIT_EXCEEDED";
  }
}

export interface SendTextMessageInput {
  phoneNumberId: string;
  to: string;
  text: string;
  accessToken: string;
  previewUrl?: boolean | undefined;
}

export interface SendTextMessageResult {
  messageId: string;
  recipientId: string;
}

export interface SendTemplateMessageInput {
  phoneNumberId: string;
  to: string;
  templateName: string;
  language: string;
  components?:
    | Array<{
        type: "header" | "body" | "button";
        sub_type?: string | undefined;
        index?: string | undefined;
        parameters: Array<{
          type: "text" | "payload";
          text?: string | undefined;
          payload?: string | undefined;
        }>;
      }>
    | undefined;
  accessToken: string;
}

export interface SendTemplateMessageResult {
  messageId: string;
  recipientId: string;
}

export interface SendMediaMessageInput {
  phoneNumberId: string;
  to: string;
  mediaType: "image" | "video" | "document" | "audio";
  /** Uploaded media ID from WhatsApp media upload endpoint */
  mediaId: string;
  /** Optional filename for document type */
  fileName?: string | undefined;
  /** Optional caption */
  caption?: string | undefined;
  accessToken: string;
}

export interface SendMediaMessageResult {
  messageId: string;
  recipientId: string;
  mediaId: string;
}

export interface UploadMediaInput {
  phoneNumberId: string;
  fileName: string;
  contentType: string;
  data: Uint8Array;
  accessToken: string;
}

export interface UploadMediaResult {
  mediaId: string;
}

export interface DownloadMediaInput {
  mediaId: string;
  accessToken: string;
  maxBytes?: number | undefined;
}

export interface DownloadMediaResult {
  data: Buffer;
  contentType: string;
  sha256?: string | undefined;
}

export interface ProviderTemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO" | "LOCATION";
  text?: string;
  buttons?: Array<{
    type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "FLOW";
    text: string;
    url?: string;
    phoneNumber?: string;
    example?: string[];
  }>;
  example?: Record<string, unknown>;
}

export interface ProviderMessageTemplate {
  id: string;
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  status: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED" | "IN_APPEAL";
  components: ProviderTemplateComponent[];
  rejected_reason?: string;
}

export interface FetchTemplatesInput {
  wabaId: string;
  accessToken: string;
  limit?: number | undefined;
  after?: string | undefined;
}

export interface FetchTemplatesResult {
  data: ProviderMessageTemplate[];
  paging?:
    | {
        cursors?:
          | {
              before?: string | undefined;
              after?: string | undefined;
            }
          | undefined;
        next?: string | undefined;
      }
    | undefined;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendTextMessage(input: SendTextMessageInput): Promise<SendTextMessageResult>;
  sendTemplateMessage(input: SendTemplateMessageInput): Promise<SendTemplateMessageResult>;
  uploadMedia(input: UploadMediaInput): Promise<UploadMediaResult>;
  downloadMedia(input: DownloadMediaInput): Promise<DownloadMediaResult>;
  sendMediaMessage(input: SendMediaMessageInput): Promise<SendMediaMessageResult>;
  fetchMessageTemplates(input: FetchTemplatesInput): Promise<FetchTemplatesResult>;
}

export function classifyMetaError(status: number, code?: number): WhatsAppErrorClassification {
  if (status === 401 || code === 190) {
    return "AUTH_FAILED";
  }
  if (status === 429 || code === 80007 || code === 130429) {
    return "RATE_LIMIT_EXCEEDED";
  }
  if (code === 131030) {
    return "USER_NOT_OPTED_IN";
  }
  if (code === 131047) {
    return "OUTSIDE_WINDOW";
  }
  if (status >= 500) {
    return "TRANSIENT";
  }
  return "INVALID_PAYLOAD";
}

export interface MetaWhatsAppProviderOptions {
  graphApiBaseUrl?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}

/**
 * Standard WhatsApp Cloud API Provider communicating with Graph API v21.0.
 */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = "meta-cloud-api";
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(options?: MetaWhatsAppProviderOptions) {
    this.baseUrl = (options?.graphApiBaseUrl ?? "https://graph.facebook.com/v21.0").replace(
      /\/+$/,
      ""
    );
    this.fetcher = options?.fetchFn ?? fetch;
  }

  async sendTextMessage(input: SendTextMessageInput): Promise<SendTextMessageResult> {
    const cleanTo = input.to.replace(/[^\d]/g, "");
    if (!cleanTo) {
      throw new WhatsAppProviderError({
        message: "Recipient phone number must contain valid digits",
        classification: "INVALID_PAYLOAD",
        statusCode: 400
      });
    }

    const url = `${this.baseUrl}/${input.phoneNumberId}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: cleanTo,
      type: "text",
      text: {
        preview_url: input.previewUrl ?? false,
        body: input.text
      }
    };

    let res: Response;
    try {
      res = await this.fetcher(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      throw new WhatsAppProviderError({
        message: `Network error dispatching to WhatsApp API: ${err instanceof Error ? err.message : String(err)}`,
        classification: "TRANSIENT",
        statusCode: 503
      });
    }

    if (!res.ok) {
      let errorBody: {
        error?: {
          message?: string;
          code?: number;
          error_subcode?: number;
          type?: string;
        };
      } = {};

      try {
        errorBody = (await res.json()) as typeof errorBody;
      } catch {
        // Fall back to empty error body
      }

      const code = errorBody.error?.code;
      const subcode = errorBody.error?.error_subcode;
      const message =
        errorBody.error?.message ?? `WhatsApp API responded with status ${res.status}`;

      let classification: WhatsAppErrorClassification = "INVALID_PAYLOAD";

      if (res.status === 401 || code === 190) {
        classification = "AUTH_FAILED";
      } else if (res.status === 429 || code === 80007 || code === 130429) {
        classification = "RATE_LIMIT_EXCEEDED";
      } else if (code === 131030) {
        classification = "USER_NOT_OPTED_IN";
      } else if (code === 131047) {
        classification = "OUTSIDE_WINDOW";
      } else if (res.status >= 500) {
        classification = "TRANSIENT";
      }

      throw new WhatsAppProviderError({
        message,
        classification,
        statusCode: res.status,
        providerCode: code,
        providerSubcode: subcode
      });
    }

    const data = (await res.json()) as {
      messages?: Array<{ id: string }>;
      contacts?: Array<{ wa_id: string }>;
    };

    const messageId = data.messages?.[0]?.id;
    const recipientId = data.contacts?.[0]?.wa_id ?? cleanTo;

    if (!messageId) {
      throw new WhatsAppProviderError({
        message: "Malformed response from WhatsApp API: missing message ID",
        classification: "TRANSIENT",
        statusCode: 502
      });
    }

    return { messageId, recipientId };
  }

  async sendTemplateMessage(input: SendTemplateMessageInput): Promise<SendTemplateMessageResult> {
    const cleanTo = input.to.replace(/[^\d]/g, "");
    if (!cleanTo) {
      throw new WhatsAppProviderError({
        message: "Recipient phone number must contain valid digits",
        classification: "INVALID_PAYLOAD",
        statusCode: 400
      });
    }

    const url = `${this.baseUrl}/${input.phoneNumberId}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: cleanTo,
      type: "template",
      template: {
        name: input.templateName,
        language: {
          code: input.language
        },
        ...(input.components && input.components.length > 0 ? { components: input.components } : {})
      }
    };

    let res: Response;
    try {
      res = await this.fetcher(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      throw new WhatsAppProviderError({
        message: `Network error dispatching template to WhatsApp API: ${err instanceof Error ? err.message : String(err)}`,
        classification: "TRANSIENT",
        statusCode: 503
      });
    }

    if (!res.ok) {
      let errorBody: {
        error?: {
          message?: string;
          code?: number;
          error_subcode?: number;
          type?: string;
        };
      } = {};

      try {
        errorBody = (await res.json()) as typeof errorBody;
      } catch {
        // Non-JSON response
      }

      const metaErr = errorBody.error;
      const status = res.status;
      const code = metaErr?.code;
      const message = metaErr?.message ?? `WhatsApp API returned HTTP ${status}`;
      const classification = classifyMetaError(status, code);

      throw new WhatsAppProviderError({
        message,
        classification,
        statusCode: status,
        providerCode: code,
        providerSubcode: metaErr?.error_subcode
      });
    }

    const data = (await res.json()) as {
      messages?: Array<{ id: string }>;
      contacts?: Array<{ wa_id: string }>;
    };

    const messageId = data.messages?.[0]?.id;
    const recipientId = data.contacts?.[0]?.wa_id ?? cleanTo;

    if (!messageId) {
      throw new WhatsAppProviderError({
        message: "Malformed response from WhatsApp API: missing message ID",
        classification: "TRANSIENT",
        statusCode: 502
      });
    }

    return { messageId, recipientId };
  }

  async fetchMessageTemplates(input: FetchTemplatesInput): Promise<FetchTemplatesResult> {
    const params = new URLSearchParams({
      fields: "id,name,language,category,status,rejected_reason,components"
    });
    if (input.limit) {
      params.set("limit", String(input.limit));
    }
    if (input.after) {
      params.set("after", input.after);
    }

    const url = `${this.baseUrl}/${encodeURIComponent(input.wabaId)}/message_templates?${params.toString()}`;
    const res = await this.fetcher(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json"
      }
    });

    if (!res.ok) {
      let errorBody: {
        error?: {
          message: string;
          type?: string;
          code?: number;
          error_subcode?: number;
        };
      } = {};

      try {
        errorBody = (await res.json()) as typeof errorBody;
      } catch {
        // Fall back to empty error body
      }

      const code = errorBody.error?.code;
      const subcode = errorBody.error?.error_subcode;
      const message =
        errorBody.error?.message ?? `WhatsApp API responded with status ${res.status}`;
      const classification = classifyMetaError(res.status, code);

      throw new WhatsAppProviderError({
        message,
        classification,
        statusCode: res.status,
        providerCode: code,
        providerSubcode: subcode
      });
    }

    const body = (await res.json()) as {
      data?: ProviderMessageTemplate[];
      paging?: FetchTemplatesResult["paging"];
    };

    return {
      data: body.data ?? [],
      paging: body.paging
    };
  }

  async sendMediaMessage(input: SendMediaMessageInput): Promise<SendMediaMessageResult> {
    const cleanTo = input.to.replace(/[^\d]/g, "");
    if (!cleanTo) {
      throw new WhatsAppProviderError({
        message: "Recipient phone number must contain valid digits",
        classification: "INVALID_PAYLOAD",
        statusCode: 400
      });
    }

    const url = `${this.baseUrl}/${input.phoneNumberId}/messages`;

    const mediaObject: Record<string, string> = { id: input.mediaId };
    if (input.fileName) mediaObject["filename"] = input.fileName;
    if (input.caption) mediaObject["caption"] = input.caption;

    let res: Response;
    try {
      res = await this.fetcher(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: cleanTo,
          type: input.mediaType,
          [input.mediaType]: mediaObject
        })
      });
    } catch (error) {
      throw new WhatsAppProviderError({
        message: `Network error dispatching media to WhatsApp API: ${error instanceof Error ? error.message : String(error)}`,
        classification: "TRANSIENT",
        statusCode: 503
      });
    }

    if (!res.ok) {
      const errorBody = (await res.json().catch(() => ({}))) as {
        error?: { code?: number; message?: string };
      };
      const code = errorBody.error?.code;
      const classification = classifyMetaError(res.status, code);
      throw new WhatsAppProviderError({
        message: errorBody.error?.message ?? `HTTP ${res.status}`,
        classification,
        statusCode: res.status,
        providerCode: code
      });
    }

    const responseBody = (await res.json()) as {
      messages?: Array<{ id: string }>;
      contacts?: Array<{ wa_id: string }>;
    };

    const messageId = responseBody.messages?.[0]?.id;
    const recipientId = responseBody.contacts?.[0]?.wa_id ?? cleanTo;

    if (!messageId) {
      throw new WhatsAppProviderError({
        message: "Malformed response from WhatsApp API: missing message ID",
        classification: "TRANSIENT",
        statusCode: 502
      });
    }

    return { messageId, recipientId, mediaId: input.mediaId };
  }

  async uploadMedia(input: UploadMediaInput): Promise<UploadMediaResult> {
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", input.contentType);
    form.set("file", new Blob([input.data], { type: input.contentType }), input.fileName);

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/${input.phoneNumberId}/media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${input.accessToken}` },
        body: form
      });
    } catch (error) {
      throw new WhatsAppProviderError({
        message: `Network error uploading media to WhatsApp API: ${error instanceof Error ? error.message : String(error)}`,
        classification: "TRANSIENT",
        statusCode: 503
      });
    }

    const body = (await response.json().catch(() => ({}))) as {
      id?: string;
      error?: { code?: number; message?: string };
    };
    if (!response.ok || !body.id) {
      throw new WhatsAppProviderError({
        message:
          body.error?.message ?? "Malformed response from WhatsApp media upload: missing media ID",
        classification: classifyMetaError(response.status, body.error?.code),
        statusCode: response.status,
        providerCode: body.error?.code
      });
    }
    return { mediaId: body.id };
  }

  async downloadMedia(input: DownloadMediaInput): Promise<DownloadMediaResult> {
    const metadataResponse = await this.fetcher(
      `${this.baseUrl}/${encodeURIComponent(input.mediaId)}`,
      { headers: { Authorization: `Bearer ${input.accessToken}` } }
    );
    const metadata = (await metadataResponse.json().catch(() => ({}))) as {
      url?: string;
      mime_type?: string;
      sha256?: string;
      file_size?: number;
      error?: { code?: number; message?: string };
    };
    if (!metadataResponse.ok || !metadata.url || !metadata.mime_type) {
      throw new WhatsAppProviderError({
        message: metadata.error?.message ?? "Malformed WhatsApp media metadata response",
        classification: classifyMetaError(metadataResponse.status, metadata.error?.code),
        statusCode: metadataResponse.status,
        providerCode: metadata.error?.code
      });
    }
    const mediaUrl = new URL(metadata.url);
    const allowedHost = ["facebook.com", "fbcdn.net", "fbsbx.com"].some(
      (suffix) => mediaUrl.hostname === suffix || mediaUrl.hostname.endsWith(`.${suffix}`)
    );
    if (mediaUrl.protocol !== "https:" || !allowedHost) {
      throw new WhatsAppProviderError({
        message: "Provider returned a media URL outside the Meta HTTPS allowlist",
        classification: "INVALID_PAYLOAD",
        statusCode: 502
      });
    }
    const maxBytes = input.maxBytes ?? 100 * 1024 * 1024;
    if (metadata.file_size !== undefined && metadata.file_size > maxBytes) {
      throw new WhatsAppProviderError({
        message: "Provider media exceeds the configured download size limit",
        classification: "INVALID_PAYLOAD",
        statusCode: 413
      });
    }
    const mediaResponse = await this.fetcher(mediaUrl, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      redirect: "error"
    });
    if (!mediaResponse.ok) {
      throw new WhatsAppProviderError({
        message: `WhatsApp media download returned HTTP ${mediaResponse.status}`,
        classification: classifyMetaError(mediaResponse.status),
        statusCode: mediaResponse.status
      });
    }
    const data = Buffer.from(await mediaResponse.arrayBuffer());
    if (data.length > maxBytes) {
      throw new WhatsAppProviderError({
        message: "Provider media exceeds the configured download size limit",
        classification: "INVALID_PAYLOAD",
        statusCode: 413
      });
    }
    return {
      data,
      contentType: metadata.mime_type,
      ...(metadata.sha256 ? { sha256: metadata.sha256 } : {})
    };
  }
}

export interface SentMessageLog extends SendTextMessageInput {
  messageId: string;
  timestamp: Date;
}

export interface MetaWebhookChangeValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: Array<{
    profile: { name: string };
    wa_id: string;
  }>;
  messages?: Array<{
    from: string;
    id: string;
    timestamp: string;
    text: { body: string };
    type: string;
  }>;
  statuses?: Array<{
    id: string;
    status: string;
    timestamp: string;
    recipient_id: string;
    errors?: Array<{ code: number; title: string; message: string }>;
  }>;
}

export interface MetaWebhookEntry {
  id: string;
  changes: Array<{
    field: string;
    value: MetaWebhookChangeValue;
  }>;
}

export interface MetaWebhookPayload {
  object: "whatsapp_business_account";
  entry: MetaWebhookEntry[];
}

/**
 * Deterministic Fake WhatsApp Provider for offline, local, and CI testing.
 */
export class FakeWhatsAppProvider implements WhatsAppProvider {
  readonly name = "fake-whatsapp-provider";
  private readonly sent: SentMessageLog[] = [];
  private templates: ProviderMessageTemplate[] = [];
  private idCounter = 1;
  public simulateFailure?:
    ((input: SendTextMessageInput) => WhatsAppProviderError | null) | undefined;

  setTemplates(templates: ProviderMessageTemplate[]): void {
    this.templates = [...templates];
  }

  addTemplate(template: ProviderMessageTemplate): void {
    this.templates.push(template);
  }

  simulateTemplateStatusUpdate(
    providerTemplateId: string,
    status: ProviderMessageTemplate["status"],
    rejectedReason?: string
  ): void {
    const tpl = this.templates.find((t) => t.id === providerTemplateId);
    if (tpl) {
      tpl.status = status;
      if (rejectedReason !== undefined) {
        tpl.rejected_reason = rejectedReason;
      }
    }
  }

  async fetchMessageTemplates(input: FetchTemplatesInput): Promise<FetchTemplatesResult> {
    await Promise.resolve();
    if (this.simulateFailure) {
      const err = this.simulateFailure({
        phoneNumberId: "",
        to: "0",
        text: "",
        accessToken: input.accessToken
      });
      if (err) throw err;
    }

    let items = [...this.templates];
    if (input.after) {
      const startIndex = items.findIndex((t) => t.id === input.after);
      if (startIndex !== -1) {
        items = items.slice(startIndex + 1);
      }
    }

    const limit = input.limit ?? items.length;
    const paginated = items.slice(0, limit);
    const hasMore = items.length > limit;
    const nextCursor =
      hasMore && paginated.length > 0 ? paginated[paginated.length - 1]!.id : undefined;

    return {
      data: paginated,
      paging: nextCursor
        ? {
            cursors: { after: nextCursor },
            next: `https://fake.graph.facebook.com/v21.0/${input.wabaId}/message_templates?after=${nextCursor}`
          }
        : undefined
    };
  }

  async sendTextMessage(input: SendTextMessageInput): Promise<SendTextMessageResult> {
    await Promise.resolve();
    if (this.simulateFailure) {
      const err = this.simulateFailure(input);
      if (err) throw err;
    }

    const cleanTo = input.to.replace(/[^\d]/g, "");
    if (!cleanTo) {
      throw new WhatsAppProviderError({
        message: "Recipient phone number must contain valid digits",
        classification: "INVALID_PAYLOAD",
        statusCode: 400
      });
    }

    const messageId = `wamid.HBgL${Date.now()}fake${this.idCounter++}==`;
    const record: SentMessageLog = {
      ...input,
      messageId,
      timestamp: new Date()
    };
    this.sent.push(record);

    return {
      messageId,
      recipientId: cleanTo
    };
  }

  async sendTemplateMessage(input: SendTemplateMessageInput): Promise<SendTemplateMessageResult> {
    await Promise.resolve();
    if (this.simulateFailure) {
      const err = this.simulateFailure({
        phoneNumberId: input.phoneNumberId,
        to: input.to,
        text: `[Template: ${input.templateName}]`,
        accessToken: input.accessToken
      });
      if (err) throw err;
    }

    const cleanTo = input.to.replace(/[^\d]/g, "");
    if (!cleanTo) {
      throw new WhatsAppProviderError({
        message: "Recipient phone number must contain valid digits",
        classification: "INVALID_PAYLOAD",
        statusCode: 400
      });
    }

    const matching = this.templates.find((t) => t.name === input.templateName);
    if (matching && matching.status !== "APPROVED") {
      throw new WhatsAppProviderError({
        message: `Template '${input.templateName}' is ${matching.status}, sending is blocked.`,
        classification: "INVALID_PAYLOAD",
        statusCode: 400
      });
    }

    const messageId = `wamid.HBgL${Date.now()}fakeTpl${this.idCounter++}==`;
    const record: SentMessageLog = {
      phoneNumberId: input.phoneNumberId,
      to: cleanTo,
      text: `[Template: ${input.templateName} (${input.language})]`,
      accessToken: input.accessToken,
      messageId,
      timestamp: new Date()
    };
    this.sent.push(record);

    return {
      messageId,
      recipientId: cleanTo
    };
  }

  async sendMediaMessage(input: SendMediaMessageInput): Promise<SendMediaMessageResult> {
    await Promise.resolve();
    if (this.simulateFailure) {
      const err = this.simulateFailure({
        phoneNumberId: input.phoneNumberId,
        to: input.to,
        text: `[Media: ${input.mediaType}:${input.mediaId}]`,
        accessToken: input.accessToken
      });
      if (err) throw err;
    }

    const cleanTo = input.to.replace(/[^\d]/g, "");
    if (!cleanTo) {
      throw new WhatsAppProviderError({
        message: "Recipient phone number must contain valid digits",
        classification: "INVALID_PAYLOAD",
        statusCode: 400
      });
    }

    const messageId = `wamid.HBgL${Date.now()}fakeMedia${this.idCounter++}==`;
    const record: SentMessageLog = {
      phoneNumberId: input.phoneNumberId,
      to: cleanTo,
      text: `[Media: ${input.mediaType}:${input.mediaId}]`,
      accessToken: input.accessToken,
      messageId,
      timestamp: new Date()
    };
    this.sent.push(record);

    return {
      messageId,
      recipientId: cleanTo,
      mediaId: input.mediaId
    };
  }

  async uploadMedia(input: UploadMediaInput): Promise<UploadMediaResult> {
    await Promise.resolve();
    if (this.simulateFailure) {
      const error = this.simulateFailure({
        phoneNumberId: input.phoneNumberId,
        to: "provider-media-upload",
        text: `[Upload: ${input.contentType}:${input.fileName}]`,
        accessToken: input.accessToken
      });
      if (error) throw error;
    }
    return { mediaId: `media-${this.idCounter++}` };
  }

  async downloadMedia(input: DownloadMediaInput): Promise<DownloadMediaResult> {
    await Promise.resolve();
    return {
      data: Buffer.from(`fake-media:${input.mediaId}`),
      contentType: "application/octet-stream"
    };
  }

  getSentMessages(): readonly SentMessageLog[] {
    return this.sent;
  }

  clear(): void {
    this.sent.length = 0;
  }

  /**
   * Generates a realistic Meta WhatsApp Cloud API inbound text webhook payload.
   */
  createInboundTextWebhook(params: {
    phoneNumberId: string;
    from: string;
    text: string;
    messageId?: string | undefined;
    timestamp?: number | undefined;
    senderName?: string | undefined;
  }): MetaWebhookPayload {
    const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);
    const messageId = params.messageId ?? `wamid.HBgL${timestamp}inbound${this.idCounter++}==`;
    const senderName = params.senderName ?? "Test Customer";

    return {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_fake_account_id",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+1 650 555 0199",
                  phone_number_id: params.phoneNumberId
                },
                contacts: [
                  {
                    profile: { name: senderName },
                    wa_id: params.from.replace(/[^\d]/g, "")
                  }
                ],
                messages: [
                  {
                    from: params.from.replace(/[^\d]/g, ""),
                    id: messageId,
                    timestamp: String(timestamp),
                    text: { body: params.text },
                    type: "text"
                  }
                ]
              }
            }
          ]
        }
      ]
    };
  }

  /**
   * Generates a realistic Meta WhatsApp status update webhook payload (e.g. sent, delivered, read).
   */
  createStatusWebhook(params: {
    phoneNumberId: string;
    messageId: string;
    recipientId: string;
    status: "sent" | "delivered" | "read" | "failed";
    timestamp?: number | undefined;
    errorCode?: number | undefined;
    errorMessage?: string | undefined;
  }): MetaWebhookPayload {
    const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);

    const statusObj: {
      id: string;
      status: string;
      timestamp: string;
      recipient_id: string;
      errors?: Array<{ code: number; title: string; message: string }>;
    } = {
      id: params.messageId,
      status: params.status,
      timestamp: String(timestamp),
      recipient_id: params.recipientId.replace(/[^\d]/g, "")
    };

    if (params.status === "failed") {
      statusObj.errors = [
        {
          code: params.errorCode ?? 131047,
          title: params.errorMessage ?? "Message failed to deliver",
          message: params.errorMessage ?? "Message failed to deliver"
        }
      ];
    }

    return {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_fake_account_id",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+1 650 555 0199",
                  phone_number_id: params.phoneNumberId
                },
                statuses: [statusObj]
              }
            }
          ]
        }
      ]
    };
  }
}
