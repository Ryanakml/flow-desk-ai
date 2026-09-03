# FlowDesk M5 AUTO Release Gate & Staged Enablement Policy

This document governs the release gate, multi-party approvals, staged tenant cohort progression, and safety evidence required before any bot or policy version can activate autonomous sending (`AUTO` mode).

---

## 1. AI Evaluation Suites & Minimum Pass Thresholds

Every bot version or policy candidate must run through the automated AI evaluation suite before release submission:

| Evaluation Suite             | Metric Name                  | Min. Threshold  | Safety Objective                                                                                |
| :--------------------------- | :--------------------------- | :-------------- | :---------------------------------------------------------------------------------------------- |
| **Grounded Quality**         | `groundedQuality`            | **≥ 0.90**      | Response contains only verified facts from retrieved documents; zero ungrounded hallucinations. |
| **No-Evidence Handling**     | `noEvidenceFailClosedRate`   | **≥ 0.95**      | Fails closed to human inbox when retrieved knowledge score is below threshold or absent.        |
| **Prohibited Intent**        | `prohibitedIntentBlockRate`  | **100% (1.00)** | Never auto-replies to billing disputes, cancellations, refunds, or legal threats.               |
| **Multilingual Accuracy**    | `multilingualAccuracy`       | **≥ 0.88**      | Bahasa Indonesia and English cross-lingual retrieval and reply accuracy.                        |
| **Prompt Injection Defense** | `promptInjectionDefenseRate` | **100% (1.00)** | Rebuffs indirect and direct prompt injections, role-play bypasses, and system leaks.            |
| **Human Escalation**         | `humanEscalationRate`        | **100% (1.00)** | Immediately transfers conversation to agent queue upon customer request or distress.            |

---

## 2. Multi-Party Approval Workflow

Automated responses cannot be activated unilaterally. Three distinct roles must record approval in the release gate:

1. **Product Manager (`product`)**: Certifies FAQ coverage, tone consistency, and expected business outcome.
2. **Security Engineer (`security`)**: Validates prompt injection defenses, PII masking, and data privacy boundaries.
3. **Engineering Peer (`peer`)**: Validates retrieval latency, rate ceilings, and failure fallback behaviors.

Approvals are recorded immutably in `flowdesk.auto_release_gates.approvals` with actor ID, timestamp, and review notes.

---

## 3. Staged Tenant Cohort Progression

Tenants and channels are promoted sequentially across three cohorts:

```
[ Internal Dogfooding ] ---> [ Controlled Beta FAQ ] ---> [ General Availability ]
   (Engineering test orgs)      (Opt-in pilot tenants)         (Full customer base)
```

- **Internal Cohort**: Used exclusively by internal support and test orgs.
- **Beta FAQ Cohort**:
  - Requires active customer consent setting (`customerConsentRequired = true`).
  - Mandatory AI disclaimer displayed on every dispatch (`aiDisclosureEnabled = true`).
  - Strict hourly rate limit ceiling: 60 messages/hour.
  - Monthly AI cost ceiling: $500.00 (50,000 cents).
  - Minimum observation window: 7 days with zero unresolved P1/P2 incidents.
- **General Cohort**: Promoted only after beta cohort criteria are satisfied and peer approved.

---

## 4. Human Review & Sampling Plan

To ensure continuous alignment with customer expectations:

- **10% Sampling Rate (`samplingRate = 0.100`)**: 1 out of every 10 autonomous sends is flagged in the supervisor inbox for post-dispatch human review.
- **Daily Review Routine**: On-call operations team reviews sampled transcripts daily.
- If quality drift or hallucination is observed:
  - Supervisor trips tenant kill switch or revokes gate approval.
  - Policy reverts to `draft` (suggested draft for human review).

---

## 5. Rollback Owners & Emergency Halt Conditions

Every release gate designates an explicit, human on-call owner (`rollbackOwner`).

### Automated Stop Conditions:

1. **Global Killswitch (`FLOWDESK_GLOBAL_KILLSWITCH = true`)**:
   - Immediately stops all AUTO dispatch across all tenants without dropping customer messages.
2. **Tenant Emergency Stop (`emergency_disabled = true`)**:
   - Trips when reply limit is exceeded or operator triggers UI toggle.
3. **Canary / SLO Degradation**:
   - If 30-day error budget drops below 20%, or production canary fails, automated sending is automatically gated off.

---

## 6. Safety Evidence & Linked Requirements

- **Takeover & Killswitch Enforcement**: Verified in Issue #177 (`feat/m5-automation-kill-switches-177`).
- **Policy Engine, Versioning & Simulation**: Verified in Issue #180 (`feat/m5-automation-policy-180`).
- **SLO Metrics, Alerts & Failure Drills**: Verified in Issue #176 (`feat/m5-slo-incident-drills-176`).
- **Immutable Production Promotion & Rollback**: Verified in Issue #181 (`feat/m5-prod-canary-rollback-181`).
- **Controlled Beta FAQ Matrix**: Verified in `apps/worker/src/m5-controlled-beta-faq.e2e.test.ts`.
