# Event naming and envelope rules

Event types use `<aggregate>.<past-tense-action>.v<major>`, for example `message.received.v1`. Queue names describe work, not implementation. Every durable event carries `eventId`, `eventType`, `schemaVersion`, `occurredAt`, `organizationId`, `aggregateId`, `correlationId`, `causationId`, actor, and typed data.

Consumers assume at-least-once delivery, validate schema before side effects, persist idempotency, tolerate supported additive fields, and classify retryable versus terminal failure. Never place secrets, full message bodies, or raw provider payloads in routing metadata or logs.
