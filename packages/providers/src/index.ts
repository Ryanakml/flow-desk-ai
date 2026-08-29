export interface ProviderHealth {
  status: "available" | "degraded" | "unavailable";
  checkedAt: string;
}

export interface HealthCheckedProvider {
  readonly name: string;
  checkHealth(): Promise<ProviderHealth>;
}

export {
  type VerifiedIdentityClaims,
  type IdentityProvider,
  MockIdentityProvider,
  type OidcProviderOptions,
  OidcIdentityProvider
} from "./identity.js";
export {
  type WhatsAppProvider,
  type SendTextMessageInput,
  type SendTextMessageResult,
  type WhatsAppErrorClassification,
  type MetaWhatsAppProviderOptions,
  type SentMessageLog,
  WhatsAppProviderError,
  MetaWhatsAppProvider,
  FakeWhatsAppProvider,
  classifyMetaError,
  type ProviderTemplateComponent,
  type ProviderMessageTemplate,
  type FetchTemplatesInput,
  type FetchTemplatesResult
} from "./whatsapp.js";
