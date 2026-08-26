# Data inventory draft

| Class       | Examples                                      | Sensitivity              | M0 handling                              | Future owner      |
| ----------- | --------------------------------------------- | ------------------------ | ---------------------------------------- | ----------------- |
| Identity    | email, provider subject, membership           | Confidential/PII         | No persisted identity data               | Identity module   |
| Messaging   | phone, message text, media, status            | Restricted/PII           | Synthetic fixtures only                  | Messaging module  |
| Credentials | provider token, signing/encryption keys       | Restricted/secret        | References only; never repository values | Security/platform |
| Audit       | actor, action, target, timestamp, reason      | Confidential             | Contract drafted                         | Audit module      |
| AI          | prompt, retrieved chunks, model output, usage | Restricted               | No AI processing                         | AI module         |
| Billing     | customer/subscription IDs, invoice metadata   | Confidential             | No billing data                          | Billing module    |
| Telemetry   | request/correlation IDs, service metrics      | Internal; may become PII | Redaction baseline                       | Platform/SRE      |

Retention, residency, deletion, export, lawful basis, subprocessors, and field-level classification must be finalized before the corresponding data first enters staging.
