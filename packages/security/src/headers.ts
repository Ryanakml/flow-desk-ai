export interface SecurityHeadersOptions {
  enableHsts?: boolean;
  cspDirectives?: string;
}

export function getSecurityHeaders(options: SecurityHeadersOptions = {}): Record<string, string> {
  const defaultCsp =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'";

  const headers: Record<string, string> = {
    "Content-Security-Policy": options.cspDirectives ?? defaultCsp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Permitted-Cross-Domain-Policies": "none"
  };

  if (options.enableHsts) {
    headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload";
  }

  return headers;
}
