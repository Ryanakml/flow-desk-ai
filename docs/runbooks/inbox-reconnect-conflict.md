# Inbox reconnect and conflict recovery

## Operator recovery

1. If the inbox says **offline**, keep the tab open and restore network access. Sending is disabled so no draft is submitted into an unknown state.
2. During **reconnecting**, the last authoritative list remains visible. FlowDesk refetches the list and selected thread when connectivity returns.
3. If **conversation changed in another session** appears, choose **Reload latest**. Review the new assignment/status/tags before repeating the action.
4. A failed optimistic text message offers **Retry** (restores its text to the composer) and **Remove**. Retry only after checking current conversation state.
5. An attachment remains unavailable while scanning. A rejected file must not be renamed or retried to bypass policy; inspect scanner operations instead.

## Support diagnosis

- Confirm `/readyz`, API/Redis health, and realtime connection metrics before asking the operator to reload the page.
- Confirm the user still has active organization and queue membership. Do not work around a revoked membership.
- A version gap is expected to trigger REST reconciliation. Repeated gaps indicate delayed/out-of-order delivery or a reconnect loop; correlate by request ID and numeric projection version, never by copying message or note content into tickets.
- For attachment failures, follow the media quarantine runbook. Never create a public bucket object or expose a storage key.

## Rollback

The M3-08 web bundle is backward compatible with the existing conversation routes. Rolling back the web image removes the new controls; saved filters, notes, and tags remain durable. Do not roll back the database migration to remove user data. If the workspace-resource route is unhealthy, roll back API and web images together to their prior immutable digests.
