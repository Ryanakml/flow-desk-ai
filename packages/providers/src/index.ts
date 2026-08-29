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
  type SendTemplateMessageInput,
  type SendTemplateMessageResult,
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
export {
  type PresignedUploadInput,
  type PresignedUploadResult,
  type GetObjectResult,
  type HeadObjectResult,
  type ObjectStore,
  type S3ObjectStoreConfig,
  S3ObjectStore,
  InMemoryObjectStore
} from "./storage.js";
export {
  type MalwareScanResult,
  type MalwareScanner,
  EICAR_TEST_SIGNATURE,
  FakeMalwareScanner
} from "./scanner.js";
