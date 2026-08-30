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
  type SendMediaMessageInput,
  type SendMediaMessageResult,
  type UploadMediaInput,
  type UploadMediaResult,
  type DownloadMediaInput,
  type DownloadMediaResult,
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
  type FetchTemplatesResult,
  type VerifyPhoneNumberInput,
  type VerifyPhoneNumberResult,
  type ExchangeEmbeddedSignupCodeInput,
  type ExchangeEmbeddedSignupCodeResult,
  type SubscribeWhatsAppBusinessAccountInput,
  type AssignWhatsAppBusinessAccountSystemUserInput
} from "./whatsapp.js";
export {
  type PresignedUploadInput,
  type PresignedUploadResult,
  type PresignedDownloadInput,
  type PresignedDownloadResult,
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
  FakeMalwareScanner,
  ClamAvScanner,
  type ClamAvScannerOptions
} from "./scanner.js";
export {
  extractKnowledgeContent,
  type ExtractedKnowledgeDocument,
  type ExtractKnowledgeOptions
} from "./knowledge-extractor.js";
export { chunkText, type TextChunk, type ChunkOptions } from "./chunker.js";
export {
  type GeneratedEmbedding,
  type AiEmbeddingProvider,
  FakeEmbeddingProvider,
  OpenAiEmbeddingProvider,
  type OpenAiEmbeddingProviderConfig
} from "./embedding.js";
export {
  type AiChatResponse,
  type AiChatProvider,
  FakeAiChatProvider,
  OpenAiChatProvider,
  type OpenAiChatProviderConfig
} from "./chat.js";
