import { describe, expect, it, vi } from "vitest";
import { FakeWhatsAppProvider, MetaWhatsAppProvider, WhatsAppProviderError } from "./whatsapp.js";

describe("WhatsApp Provider Adapter (M2-02)", () => {
  describe("FakeWhatsAppProvider", () => {
    it("records sent messages and returns deterministic IDs", async () => {
      const fake = new FakeWhatsAppProvider();
      expect(fake.getSentMessages()).toHaveLength(0);

      const res = await fake.sendTextMessage({
        phoneNumberId: "1234567890",
        to: "+1 (650) 555-0123",
        text: "Hello from FlowDesk agent!",
        accessToken: "test_token"
      });

      expect(res.messageId).toContain("wamid.");
      expect(res.recipientId).toBe("16505550123");
      expect(fake.getSentMessages()).toHaveLength(1);
      expect(fake.getSentMessages()[0]?.text).toBe("Hello from FlowDesk agent!");

      fake.clear();
      expect(fake.getSentMessages()).toHaveLength(0);
    });

    it("generates realistic inbound text webhook payload", () => {
      const fake = new FakeWhatsAppProvider();
      const payload = fake.createInboundTextWebhook({
        phoneNumberId: "9876543210",
        from: "+62 812 3456 7890",
        text: "I need help with my booking",
        senderName: "Budi"
      });

      expect(payload.object).toBe("whatsapp_business_account");
      const entry = payload.entry[0];
      expect(entry).toBeDefined();
      const change = entry?.changes[0]?.value;
      expect(change).toBeDefined();
      expect(change?.metadata.phone_number_id).toBe("9876543210");
      expect(change?.contacts?.[0]?.profile.name).toBe("Budi");
      expect(change?.contacts?.[0]?.wa_id).toBe("6281234567890");
      expect(change?.messages?.[0]?.text.body).toBe("I need help with my booking");
    });

    it("generates realistic status webhook payload", () => {
      const fake = new FakeWhatsAppProvider();
      const payload = fake.createStatusWebhook({
        phoneNumberId: "9876543210",
        messageId: "wamid.test12345==",
        recipientId: "+16505550123",
        status: "delivered"
      });

      const entry = payload.entry[0];
      expect(entry).toBeDefined();
      const change = entry?.changes[0]?.value;
      expect(change).toBeDefined();
      expect(change?.statuses?.[0]?.id).toBe("wamid.test12345==");
      expect(change?.statuses?.[0]?.status).toBe("delivered");
      expect(change?.statuses?.[0]?.recipient_id).toBe("16505550123");
    });

    it("simulates classified errors when configured", async () => {
      const fake = new FakeWhatsAppProvider();
      fake.simulateFailure = () =>
        new WhatsAppProviderError({
          message: "Recipient is outside 24h service window",
          classification: "OUTSIDE_WINDOW",
          statusCode: 400,
          providerCode: 131047
        });

      await expect(
        fake.sendTextMessage({
          phoneNumberId: "123",
          to: "123456789",
          text: "Hi",
          accessToken: "token"
        })
      ).rejects.toThrow("Recipient is outside 24h service window");
    });
  });

  describe("MetaWhatsAppProvider", () => {
    it("dispatches successfully to Meta Graph API endpoint", async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              messages: [{ id: "wamid.realMeta123==" }],
              contacts: [{ wa_id: "16505550199" }]
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          )
        )
      );

      const provider = new MetaWhatsAppProvider({
        fetchFn: mockFetch as typeof fetch
      });

      const res = await provider.sendTextMessage({
        phoneNumberId: "phone_12345",
        to: "+1 650 555-0199",
        text: "Live message from FlowDesk",
        accessToken: "EAAB_test_access_token"
      });

      expect(res.messageId).toBe("wamid.realMeta123==");
      expect(res.recipientId).toBe("16505550199");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://graph.facebook.com/v21.0/phone_12345/messages",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Bearer EAAB_test_access_token",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: "16505550199",
            type: "text",
            text: {
              preview_url: false,
              body: "Live message from FlowDesk"
            }
          })
        })
      );
    });

    it("classifies authentication failures (401 / code 190)", async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                message: "Invalid OAuth access token",
                type: "OAuthException",
                code: 190
              }
            }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" }
            }
          )
        )
      );

      const provider = new MetaWhatsAppProvider({ fetchFn: mockFetch as typeof fetch });

      try {
        await provider.sendTextMessage({
          phoneNumberId: "phone_12345",
          to: "16505550199",
          text: "Hi",
          accessToken: "expired_token"
        });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(WhatsAppProviderError);
        const wErr = err as WhatsAppProviderError;
        expect(wErr.classification).toBe("AUTH_FAILED");
        expect(wErr.isTransient).toBe(false);
        expect(wErr.providerCode).toBe(190);
      }
    });

    it("classifies rate limit errors as transient (429 / code 130429)", async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                message: "Rate limit exceeded",
                code: 130429
              }
            }),
            {
              status: 429,
              headers: { "Content-Type": "application/json" }
            }
          )
        )
      );

      const provider = new MetaWhatsAppProvider({ fetchFn: mockFetch as typeof fetch });

      try {
        await provider.sendTextMessage({
          phoneNumberId: "phone_12345",
          to: "16505550199",
          text: "Hi",
          accessToken: "token"
        });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(WhatsAppProviderError);
        const wErr = err as WhatsAppProviderError;
        expect(wErr.classification).toBe("RATE_LIMIT_EXCEEDED");
        expect(wErr.isTransient).toBe(true);
      }
    });

    it("classifies 5xx errors as transient", async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({}), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          })
        )
      );

      const provider = new MetaWhatsAppProvider({ fetchFn: mockFetch as typeof fetch });

      try {
        await provider.sendTextMessage({
          phoneNumberId: "phone_12345",
          to: "16505550199",
          text: "Hi",
          accessToken: "token"
        });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(WhatsAppProviderError);
        const wErr = err as WhatsAppProviderError;
        expect(wErr.classification).toBe("TRANSIENT");
        expect(wErr.isTransient).toBe(true);
      }
    });

    it("fetches message templates via MetaWhatsAppProvider and parses payload", async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  id: "tpl_123",
                  name: "shipping_update",
                  language: "id",
                  category: "UTILITY",
                  status: "APPROVED",
                  components: [{ type: "BODY", text: "Pesanan {{1}} dikirim." }]
                }
              ],
              paging: {
                cursors: { after: "cursor_abc" },
                next: "https://graph.facebook.com/v21.0/waba_123/message_templates?after=cursor_abc"
              }
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          )
        )
      );

      const provider = new MetaWhatsAppProvider({ fetchFn: mockFetch as typeof fetch });
      const result = await provider.fetchMessageTemplates({
        wabaId: "waba_123",
        accessToken: "valid_token"
      });

      expect(result.data.length).toBe(1);
      expect(result.data[0]?.name).toBe("shipping_update");
      expect(result.data[0]?.status).toBe("APPROVED");
      expect(result.paging?.cursors?.after).toBe("cursor_abc");
    });
  });

  describe("FakeWhatsAppProvider template sync", () => {
    it("manages and paginates mock templates", async () => {
      const fake = new FakeWhatsAppProvider();
      fake.setTemplates([
        {
          id: "tpl-1",
          name: "welcome",
          language: "en_US",
          category: "MARKETING",
          status: "APPROVED",
          components: [{ type: "BODY", text: "Welcome!" }]
        },
        {
          id: "tpl-2",
          name: "alert",
          language: "id",
          category: "UTILITY",
          status: "PENDING",
          components: [{ type: "BODY", text: "Peringatan!" }]
        }
      ]);

      const page1 = await fake.fetchMessageTemplates({
        wabaId: "fake_waba",
        accessToken: "tok",
        limit: 1
      });

      expect(page1.data.length).toBe(1);
      expect(page1.data[0]?.id).toBe("tpl-1");
      expect(page1.paging?.cursors?.after).toBe("tpl-1");

      const page2 = await fake.fetchMessageTemplates({
        wabaId: "fake_waba",
        accessToken: "tok",
        after: "tpl-1"
      });

      expect(page2.data.length).toBe(1);
      expect(page2.data[0]?.id).toBe("tpl-2");
    });

    it("simulates template status update", async () => {
      const fake = new FakeWhatsAppProvider();
      fake.addTemplate({
        id: "tpl-reject",
        name: "discount",
        language: "id",
        category: "MARKETING",
        status: "PENDING",
        components: [{ type: "BODY", text: "Diskon 50%!" }]
      });

      fake.simulateTemplateStatusUpdate(
        "tpl-reject",
        "REJECTED",
        "Content violates commercial policy"
      );

      const res = await fake.fetchMessageTemplates({
        wabaId: "fake_waba",
        accessToken: "tok"
      });

      expect(res.data[0]?.status).toBe("REJECTED");
      expect(res.data[0]?.rejected_reason).toBe("Content violates commercial policy");
    });

    it("sends approved template message and records log", async () => {
      const fake = new FakeWhatsAppProvider();
      fake.addTemplate({
        id: "tpl-welcome",
        name: "welcome_message",
        language: "id",
        category: "UTILITY",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Selamat datang!" }]
      });

      const res = await fake.sendTemplateMessage({
        phoneNumberId: "phone_12345",
        to: "+628123456789",
        templateName: "welcome_message",
        language: "id",
        accessToken: "test_token"
      });

      expect(res.messageId).toContain("wamid.HBgL");
      expect(res.recipientId).toBe("628123456789");
      expect(fake.getSentMessages()).toHaveLength(1);
    });

    it("blocks non-approved template send on FakeWhatsAppProvider", async () => {
      const fake = new FakeWhatsAppProvider();
      fake.addTemplate({
        id: "tpl-pending",
        name: "pending_tpl",
        language: "id",
        category: "MARKETING",
        status: "PENDING",
        components: [{ type: "BODY", text: "Promo pending" }]
      });

      await expect(
        fake.sendTemplateMessage({
          phoneNumberId: "phone_12345",
          to: "+628123456789",
          templateName: "pending_tpl",
          language: "id",
          accessToken: "test_token"
        })
      ).rejects.toThrow("Template 'pending_tpl' is PENDING, sending is blocked");
    });
  });

  describe("MetaWhatsAppProvider sendTemplateMessage", () => {
    it("formats template payload for Graph API and returns message ID", async () => {
      let capturedUrl = "";
      let capturedPayload: unknown = null;

      const mockFetch = vi.fn().mockImplementation((url: string, opts: RequestInit) => {
        capturedUrl = url;
        capturedPayload = JSON.parse(opts.body as string);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              messages: [{ id: "wamid.HBgLmetaTemplateSend123==" }],
              contacts: [{ wa_id: "628123456789" }]
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          )
        );
      });

      const provider = new MetaWhatsAppProvider({ fetchFn: mockFetch as typeof fetch });
      const res = await provider.sendTemplateMessage({
        phoneNumberId: "phone_001",
        to: "+62 812-3456-789",
        templateName: "order_status",
        language: "id",
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: "ORD-999" }]
          }
        ],
        accessToken: "EAAB_secret"
      });

      expect(capturedUrl).toBe("https://graph.facebook.com/v21.0/phone_001/messages");
      expect(capturedPayload).toEqual({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "628123456789",
        type: "template",
        template: {
          name: "order_status",
          language: { code: "id" },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: "ORD-999" }]
            }
          ]
        }
      });
      expect(res.messageId).toBe("wamid.HBgLmetaTemplateSend123==");
      expect(res.recipientId).toBe("628123456789");
    });

    it("classifies outside service window error (code 131047)", async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                message:
                  "Re-engagement message: More than 24 hours have elapsed since the customer last replied to this number.",
                type: "OAuthException",
                code: 131047
              }
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" }
            }
          )
        )
      );

      const provider = new MetaWhatsAppProvider({ fetchFn: mockFetch as typeof fetch });
      try {
        await provider.sendTextMessage({
          phoneNumberId: "phone_001",
          to: "628123456789",
          text: "Free-form follow up after 24h",
          accessToken: "EAAB_secret"
        });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(WhatsAppProviderError);
        const wErr = err as WhatsAppProviderError;
        expect(wErr.classification).toBe("OUTSIDE_WINDOW");
        expect(wErr.providerCode).toBe(131047);
      }
    });
  });
});
