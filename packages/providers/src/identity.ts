export interface VerifiedIdentityClaims {
  provider: string;
  subject: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
}

export interface IdentityProvider {
  readonly name: string;
  exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<VerifiedIdentityClaims>;
}

export class MockIdentityProvider implements IdentityProvider {
  readonly name = "mock";

  async exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<VerifiedIdentityClaims> {
    await Promise.resolve();
    if (!input.code || input.code === "invalid-code") {
      throw new Error("Invalid or rejected authorization code");
    }
    const email = input.code.startsWith("user:") ? input.code.slice(5) : "operator@flowdesk.dev";
    const namePart = email.split("@")[0] ?? "Operator";
    const displayName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
    return {
      provider: "mock",
      subject: `mock|${namePart.toLowerCase()}`,
      email,
      displayName,
      emailVerified: true
    };
  }
}

export interface OidcProviderOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

export class OidcIdentityProvider implements IdentityProvider {
  readonly name = "oidc";

  constructor(private readonly options: OidcProviderOptions) {}

  async exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<VerifiedIdentityClaims> {
    const tokenEndpoint = new URL(
      "oauth/token",
      this.options.issuer.endsWith("/") ? this.options.issuer : `${this.options.issuer}/`
    );

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri
    });

    const response = await fetch(tokenEndpoint.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OIDC token exchange failed (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as {
      id_token?: string;
      access_token?: string;
    };

    if (!payload.access_token && !payload.id_token) {
      throw new Error("OIDC token response contained neither access_token nor id_token");
    }

    if (payload.id_token) {
      const parts = payload.id_token.split(".");
      if (parts.length === 3 && parts[1]) {
        const decoded = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
          sub?: string;
          email?: string;
          email_verified?: boolean;
          name?: string;
        };
        if (decoded.sub && decoded.email) {
          return {
            provider: "oidc",
            subject: decoded.sub,
            email: decoded.email,
            displayName: decoded.name || decoded.email,
            emailVerified: Boolean(decoded.email_verified)
          };
        }
      }
    }

    const userinfoEndpoint = new URL(
      "userinfo",
      this.options.issuer.endsWith("/") ? this.options.issuer : `${this.options.issuer}/`
    );
    const userinfoResponse = await fetch(userinfoEndpoint.toString(), {
      headers: { Authorization: `Bearer ${payload.access_token}` }
    });

    if (!userinfoResponse.ok) {
      throw new Error(`Failed to fetch userinfo (${userinfoResponse.status})`);
    }

    const userinfo = (await userinfoResponse.json()) as {
      sub: string;
      email: string;
      name?: string;
      email_verified?: boolean;
    };

    return {
      provider: "oidc",
      subject: userinfo.sub,
      email: userinfo.email,
      displayName: userinfo.name || userinfo.email,
      emailVerified: Boolean(userinfo.email_verified)
    };
  }
}
