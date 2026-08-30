# Meta Embedded Signup — FlowDesk Production Runbook

FlowDesk uses one platform-owned Meta App. Customers authorize their existing or new WhatsApp Business Account (WABA) through Meta Embedded Signup; they never provide an App Secret or manually paste an access token.

## One-time Meta configuration

1. In the FlowDesk Meta App, add the WhatsApp product and create the Embedded Signup configuration. Record the App ID and configuration ID.
2. Configure the FlowDesk HTTPS domain and the exact production origin in Meta's allowed-domain and redirect settings.
3. Configure the WhatsApp webhook once for the **FlowDesk Meta App**:
   - Callback URL: `https://<flowdesk-ingress-host>/webhooks/whatsapp`
   - Verify token: the value of `WEBHOOK_VERIFY_TOKEN`
   - Subscribe to the required WhatsApp fields, including `messages`.
4. Create the FlowDesk runtime system user and a Business Admin system user. Assign the runtime user to each approved customer WABA with `MANAGE`; store its ID as `META_SYSTEM_USER_ID`, its management token as `META_SYSTEM_USER_ACCESS_TOKEN`, and the admin token used for the assignment as `META_ADMIN_SYSTEM_USER_ACCESS_TOKEN`.
5. Complete Meta business verification, App Review, and Advanced Access required by the selected Embedded Signup configuration before onboarding external customers.

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

## Customer flow and safety checks

1. Customer admin selects **Connect WhatsApp with Meta** in FlowDesk.
2. FlowDesk creates a tenant-bound, single-use connection attempt that expires in ten minutes.
3. The browser opens Meta Embedded Signup using only the App ID and configuration ID.
4. The browser returns the one-time code and selected WABA/phone identifiers to FlowDesk. The API treats those identifiers as candidates and verifies their relationship with Meta.
5. The API uses the user-authorized token only to verify the selected account. It assigns and verifies FlowDesk's runtime system user, encrypts that platform token as the tenant credential, claims WABA and phone ownership for one FlowDesk organization, subscribes the WABA, then activates the channel.
6. If exchange, verification, ownership, or subscription fails, the channel is not active. A partially connected channel is marked `degraded` and must be reconnected through Meta.

Existing customers should use **Reconnect with Meta**. It refreshes the encrypted credential in place and preserves the channel's conversation and message relationships.

## Release verification

Before declaring the release live, prove all of the following in staging with a real Meta test WABA:

1. Callback URL challenge returns the raw `hub.challenge` with the configured verify token.
2. A new user can select an existing WABA through Embedded Signup without entering a token or App Secret.
3. FlowDesk receives an inbound message and a delivery status webhook after the WABA subscription succeeds.
4. Outbound sending works using the stored encrypted credential.
5. A second organization cannot attach the same WABA or phone number.
6. Replaying an onboarding completion request fails.
7. Failure to subscribe leaves the channel non-active and exposes no secret in the UI, API response, or logs.
