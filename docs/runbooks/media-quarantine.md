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

## 4. Emergency Quarantine Purge

To purge quarantined objects older than retention window:

```bash
# Verify S3 connectivity
mc ls local/flowdesk-local/

# Delete rejected objects from storage key
mc rm --recursive --force local/flowdesk-local/org-<orgId>/quarantine/<attachmentId>/
```
