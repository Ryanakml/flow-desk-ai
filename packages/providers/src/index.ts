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
