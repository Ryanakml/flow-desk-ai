# Severity, CI, and evidence policy

| Severity | Example impact                                                                         | Response target                                                |
| -------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| SEV-1    | Confirmed cross-tenant disclosure, widespread message outage, unrecoverable corruption | Immediate incident command and executive/security notification |
| SEV-2    | Major customer workflow unavailable or materially delayed                              | Page primary owner; mitigate urgently                          |
| SEV-3    | Limited degradation with workaround                                                    | Working-hours owner and scheduled correction                   |
| SEV-4    | Minor defect or documentation gap                                                      | Normal backlog                                                 |

M0 CI targets a 15-minute quality job and 30-minute image matrix. A red required check blocks merge. The author owns first diagnosis; the capability owner owns systemic correction. Artifacts are retained for 14 days until release evidence introduces a longer policy.

A test is flaky when identical code and inputs alternate pass/fail. It may be quarantined only with a defect, owner, reason, and expiry no longer than seven days. Required security and tenant-isolation tests cannot be quarantined. CI retries infrastructure setup only when the retry is visible; assertions are never retried to manufacture green.

Use the CI manual input `run_failure_probe=true` to prove a deliberate exit code blocks the workflow after repository settings are enabled.
