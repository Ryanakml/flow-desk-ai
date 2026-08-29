# Conversation operations runbook

The authoritative mutation endpoint is `POST /api/v1/organizations/{orgId}/conversations/{id}/actions`. Every request includes the last observed `version`; a successful action increments it and returns the current database projection.

## Conflict handling

- `409 OPTIMISTIC_CONCURRENCY_CONFLICT`: reload the conversation and let the operator re-evaluate the action. Never auto-replay a stale mutation.
- `409 CONVERSATION_ACTION_CONFLICT`: the state is current but the requested action is invalid, such as claiming work owned by another agent.
- `403 CONVERSATION_ACCESS_REVOKED`: organization or queue membership is no longer active. Clear cached conversation data and return to the visible queue list.
- `409 CONVERSATION_CLOSED`: reopen the conversation before composing a new outbound message.

The database locks the conversation and active membership before checking the version. State, metadata-only timeline entry, and audit record share one tenant transaction. This produces one winner for simultaneous claims and prevents a removed agent from completing a later action with stale browser state.

## SLA and business hours

Queue SLA deadlines are initialized on first claim. If a business-hours policy is attached, `weekly_schedule` uses lowercase weekday keys and arrays of `{ "start": "09:00", "end": "17:00" }` local-time intervals. Holiday entries use `YYYY-MM-DD` in the policy timezone. Invalid/closed schedules fail the claim instead of silently calculating an unsafe deadline.

The first outbound agent message records `first_responded_at` for response-SLA evidence. Resolution timestamps are set on resolve and cleared on reopen; historical lifecycle and audit entries remain intact.

## Incident checks

1. Capture the request/correlation ID and the returned problem code.
2. Compare the browser version with `conversations.version` through an authorized support session.
3. Verify active organization, team, and queue memberships. Do not override access in the browser.
4. Inspect `conversation_events` and `audit_logs` by correlation ID. Private note bodies are not copied into either metadata stream.
5. For repeated claim conflicts, inspect routing membership and assignment churn before changing state manually.
