# API style guide

- Public product endpoints start with `/api/v1`; health endpoints remain unversioned.
- JSON fields use camelCase and UTC timestamps use RFC 3339.
- Validate request and response against shared Zod/OpenAPI 3.1 contracts.
- Errors use `application/problem+json` with `type`, `title`, `status`, `code`, `detail`, `requestId`, and field `errors` when applicable.
- Large collections use opaque cursor pagination with deterministic ordering.
- Mutations that can duplicate an effect require `Idempotency-Key` and document replay semantics.
- IDs are opaque; knowing an ID never grants access. Tenant-inaccessible resources return the contractually chosen denial without leaking existence.
- Backward-compatible additions may ship within a version. Removal or semantic break requires a new version and deprecation window.
