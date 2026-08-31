# WhatsApp Connection — FlowDesk Production Runbook

FlowDesk uses one platform-owned Meta App. The primary operational path is an operator-assisted verified connection: an authorized organization admin enters the channel name, Phone Number ID, WABA ID, and an access token issued for that Meta App. FlowDesk verifies ownership, subscribes the WABA, encrypts the exact same token, and only then activates the channel. Meta Embedded Signup remains available when all platform credentials are configured.

## One-time Meta configuration

1. In the FlowDesk Meta App, add the WhatsApp product and create the Embedded Signup configuration. Record the App ID and configuration ID.
2. Configure the FlowDesk HTTPS domain and the exact production origin in Meta's allowed-domain and redirect settings.
3. Configure the WhatsApp webhook once for the **FlowDesk Meta App**:
   - Callback URL: `https://<flowdesk-ingress-host>/webhooks/whatsapp`
   - Verify token: the value of `WEBHOOK_VERIFY_TOKEN`
   - Subscribe to the required WhatsApp fields, including `messages`.
4. Create a token for each connected WABA with the permissions needed to inspect the phone number, subscribe the WABA, and send messages. Never paste the App Secret into FlowDesk's channel form.
5. To enable the optional Embedded Signup path, create the FlowDesk runtime system user and a Business Admin system user, then configure the Embedded Signup variables listed below.
6. Complete Meta business verification, App Review, and Advanced Access required before onboarding external customers.

Meta requires a WABA to be explicitly subscribed before it delivers webhook events for that account. The subscription is performed by FlowDesk after a successful user authorization. [Meta WABA subscriptions](https://www.postman.com/meta/whatsapp-business-platform/folder/gumbt4j/waba-subscriptions)

## Deployment secrets

Set these values only in the deployment secret manager. Do not put them in browser environment variables, source control, tenant tables, support tickets, or application logs.

- `META_APP_ID` — public identifier returned only to begin the Meta popup.
- `META_EMBEDDED_SIGNUP_CONFIG_ID` — public Embedded Signup configuration identifier returned only to begin the Meta popup.
- `META_APP_SECRET` — FlowDesk Meta App secret, used only by the API to exchange the one-time authorization code.
- `META_SYSTEM_USER_ACCESS_TOKEN` — FlowDesk platform system-user token, used only by the API to subscribe the selected WABA.
- `META_SYSTEM_USER_ID` — FlowDesk runtime system-user identifier assigned to each connected WABA; never returned to the browser.
- `META_ADMIN_SYSTEM_USER_ACCESS_TOKEN` — Business Admin system-user token used only to assign the runtime user to the selected WABA.
- `META_GRAPH_API_BASE_URL` — the currently supported, versioned Graph API base URL, for example `https://graph.facebook.com/v25.0`.
- `WEBHOOK_VERIFY_TOKEN` — FlowDesk ingress challenge token, configured once in the Meta App dashboard.
- `WEBHOOK_APP_SECRET` — same FlowDesk Meta App secret used by ingress to validate `X-Hub-Signature-256`.

`WEBHOOK_APP_SECRET` and `META_APP_SECRET` must refer to the same FlowDesk Meta App.

The six `META_*` Embedded Signup credentials are optional as a group. Placeholder values disable Embedded Signup; partial real configuration fails startup. `META_GRAPH_API_BASE_URL` is independent and is shared by the API and worker. `WEBHOOK_VERIFY_TOKEN`, `WEBHOOK_APP_SECRET`, and `ENCRYPTION_KEY` are mandatory outside local development; deployment defaults and placeholders are rejected.

## Customer flow and safety checks

1. Organization admin selects **Connect WhatsApp** in FlowDesk.
2. The admin enters the channel name, Phone Number ID, WABA ID, and access token. The UI never requests the Meta App Secret.
3. The API verifies that the token can inspect the Phone Number ID and that the phone belongs to the stated WABA.
4. FlowDesk claims WABA and phone ownership for one organization, encrypts the submitted token, and marks the channel `connecting`.
5. The API subscribes that WABA using the exact submitted token. Only a successful subscription changes the channel to `active`; the worker later decrypts that same token for outbound sends.
6. Verification failure creates no channel. Subscription failure leaves the channel `degraded`, with no secret returned by the UI, API, or logs.

Existing customers should use **Reconnect with token**. It verifies and rotates the encrypted credential in place, re-subscribes the WABA, and preserves the channel's conversation and message relationships. **Connect with Meta Signup** remains an optional secondary path.

## Release verification

Before declaring the release live, prove all of the following in staging with a real Meta test WABA:

1. Callback URL challenge returns the raw `hub.challenge` with the configured verify token.
2. A valid customer token connects the expected Phone Number ID/WABA pair; an invalid or mismatched token does not create an active channel.
3. FlowDesk receives an inbound message and a delivery status webhook after the WABA subscription succeeds.
4. Outbound sending works using the stored encrypted credential.
5. A second organization cannot attach the same WABA or phone number.
6. Replaying an onboarding completion request fails.
7. Failure to subscribe leaves the channel non-active and exposes no secret in the UI, API response, or logs.
