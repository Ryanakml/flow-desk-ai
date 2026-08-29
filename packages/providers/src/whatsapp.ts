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
