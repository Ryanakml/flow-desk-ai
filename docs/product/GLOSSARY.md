# Domain glossary

- **Organization:** Security, billing, configuration, and data-isolation boundary. Synonym: tenant only in infrastructure discussions.
- **Membership:** A user's active relationship to exactly one organization and its permissions.
- **Channel:** An organization's configured WhatsApp Business endpoint and credentials.
- **Contact:** Organization-owned representation of an external person; never a global identity.
- **Conversation:** Ordered operational context between one channel and contact.
- **Message:** Immutable inbound or outbound communication record with a delivery lifecycle.
- **Agent:** Authorized human operator; avoid “user” when the operational role matters.
- **Bot mode:** `OFF`, `DRAFT`, or `AUTO`; mode never overrides eligibility and safety policy.
- **Tenant context:** Validated organization, actor, and correlation scope required by tenant operations.
- **Provider:** External system reached only through an owned adapter contract.
