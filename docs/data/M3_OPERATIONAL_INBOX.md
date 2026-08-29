# M3 operational inbox model

Migration `0010_m3_operational_inbox.sql` adds the durable routing and agent-state model used by M3. Every tenant-owned table has a non-null `organization_id`, a tenant policy, and both enabled and forced row-level security.

## Ownership and routing

- `teams` and `team_memberships` represent organizational grouping and agent capacity.
- `queues` bind an optional team, SLA policy, and business-hours policy to one routing strategy.
- `queue_memberships` are the authoritative per-user visibility boundary. A removed membership is excluded immediately by `listVisibleQueues`; browser state is never treated as authorization.
- Composite tenant foreign keys prevent a known identifier from another tenant being attached to a local record.

## Conversation operations

`conversations` gains queue/team routing, waiting reason, bot-pause state, and response/resolution deadlines. Inbox and SLA indexes support tenant-first cursor queries. Existing optimistic `version` remains the write precondition and is exercised by the M3-02 mutation API.

Private notes, tags, per-agent read markers, and saved filters live in separate normalized tables. A private note cannot enter `messages` or `outbound_intents`; its trigger records only a metadata-only `conversation.note_added` timeline event. Conversation routing, priority, waiting, and bot-pause changes also append lifecycle events.

## Lifecycle rules

- Membership rows are retained with `removed` status so authorization changes are auditable.
- Teams and queues are archived instead of deleted during ordinary operation.
- Notes remain internal records; editing records `edited_at` and deletion is not exposed to runtime workflows.
- Business-hour holiday dates and weekly schedules are policy inputs. M3-02 calculates timezone-aware claim deadlines, records the first agent response, and keeps SLA evidence in the authoritative conversation projection.

## Operator workspace (M3-08)

The web inbox now reads visible queues, organization tags, private notes, and the active user's saved filters from tenant-scoped REST projections. Claim, resolve/reopen, note, and tag mutations use the versioned conversation operation API; a `409` never silently overwrites another operator and presents an explicit authoritative-reload action.

The browser treats Socket.IO events as invalidation hints. A version gap skips the hint and refetches the authorized REST projection. Offline and reconnecting states are announced through a live region, outbound controls stop while offline, failed optimistic text can be restored to the composer or removed, and a reconnect preserves the already rendered list until fresh data arrives.

Media composition uses the M3-06/M3-07 lifecycle: create a short-lived upload session, upload directly to the private object store, complete quarantine, poll the authorized attachment projection until scanning is clean, then create a media outbound intent. The browser never receives a permanent public object URL.

The primary workflow uses native controls, listbox keyboard navigation, visible focus rings, trapped/restored modal focus, and English/Indonesian copy. Automated browser coverage runs axe-core and rejects serious or critical findings. Responsive rules collapse collaboration and composer controls below tablet/mobile breakpoints.

## Privacy boundary

No third-party analytics or browser telemetry SDK is installed in `@flowdesk/web`. Realtime events contain identifiers and projection versions, never message bodies, private-note bodies, phone numbers, filenames, or attachment bytes. Customer content travels only to first-party authenticated REST endpoints and the explicitly authorized short-lived object-store upload URL. Introducing browser telemetry requires a separate privacy review and payload test before release.
