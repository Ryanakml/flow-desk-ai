# Runbook: Media Quarantine & Malicious Attachment Handling

## 1. Context & Scope

This runbook covers operator and platform engineering procedures for investigating and managing attachments that enter the `quarantine` or `rejected` states in Flowdesk.

- **Threat Reference:** `TM-006` (_Malicious attachment / SSRF / MIME Spoofing_)
- **Target Capability:** `MEDIA-PIPE-001`

---

## 2. Attachment Lifecycle & Statuses

```
[ Upload Session Created ] ---> status = "quarantine"
                                     |
               +---------------------+---------------------+
               | (worker scan passes)|                     | (any check fails)
               v                                           v
       status = "clean"                            status = "rejected"
(Available for dispatch/download)          (Blocked from operator access & dispatch)
```

---

## 3. Investigating Rejected Attachments

When an attachment is rejected, query its record in PostgreSQL:

```sql
SELECT id, organization_id, file_name, content_type, detected_mime_type,
       byte_size, sha256_checksum, status, quarantine_reason, scanned_at, scanner_name
FROM flowdesk.attachments
WHERE status = 'rejected'
ORDER BY updated_at DESC
LIMIT 10;
```

### Common Rejection Reasons & Resolution:

1. **`MIME_SPOOFED`**:
   - **Meaning:** Declared MIME type (e.g. `image/jpeg`) did not match detected magic bytes (e.g. `application/pdf` or executable binary).
   - **Action:** Treat as potential malicious payload or client misconfiguration. Inform customer support not to re-upload.
2. **`CHECKSUM_MISMATCH`**:
   - **Meaning:** Computed SHA-256 did not match client-supplied hash.
   - **Action:** Network corruption during upload or client-side tampering. Advise client to retry upload.
3. **`MALWARE_DETECTED`**:
   - **Meaning:** Anti-malware scanner identified signature (e.g. EICAR or known malware).
   - **Action:** Verify alert in scanner logs. The attachment is already quarantined and blocked. Trigger security incident response if origin was internal operator account.
4. **`EXCEEDS_SIZE_LIMIT`**:
   - **Meaning:** File exceeds category limits (16MB image/audio, 100MB video/doc).
   - **Action:** Direct customer to compress media or use smaller file.

---

## 4. Authorized download and outbound delivery

- The API checks the live session, organization membership, and `conversation:read` permission before issuing a five-minute signed GET URL.
- Only `clean` and non-tombstoned records can receive a signed URL. Quarantine, rejected, deleted, foreign-tenant, and removed-member requests fail closed.
- The object bucket remains private. Never copy a signed URL into tickets or logs; revoke the operator membership and rotate object-store credentials if a URL is exposed.
- Media replies use the normal idempotent outbound intent. The worker reads private bytes, uploads them to the WhatsApp media endpoint, then sends the returned provider media ID. An uncertain send is moved to `reconcile_required`; do not blindly replay it.

## 5. Automated retention and deletion

The worker runs retention hourly. Defaults are 90 days for clean/quarantine objects and 7 days for rejected objects, configured with `MEDIA_CLEAN_RETENTION_DAYS` and `MEDIA_REJECTED_RETENTION_DAYS`.

Deletion order is deliberate: object bytes are deleted first, then the tenant record is tombstoned with `deleted_at`, `deletion_reason=retention_expiry`, and an `attachment.deleted` outbox audit event. A storage failure leaves the record intact and increments `media_lifecycle_total{operation="retention",outcome="failed"}` for alerting.

To verify one deletion without exposing customer data:

```sql
SELECT id, organization_id, status, deleted_at, deletion_reason
FROM flowdesk.attachments
WHERE id = '<attachment-id>' AND organization_id = '<organization-id>';
```

Confirm the object key no longer exists with a tenant-scoped storage credential. Do not restore or manually purge bytes without an approved support/security ticket.

## 6. Emergency Quarantine Purge

To purge quarantined objects older than retention window:

```bash
# Verify S3 connectivity
mc ls local/flowdesk-local/

# Delete rejected objects from storage key
mc rm --recursive --force local/flowdesk-local/org-<orgId>/quarantine/<attachmentId>/
```

After an approved manual object deletion, invoke the tenant-scoped tombstone path or record equivalent audited evidence. Deleting only the database row is prohibited because it can orphan private bytes.
