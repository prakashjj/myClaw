/**
 * WhatsApp Channel Plugin
 *
 * Connects MyClaw to WhatsApp using the Cloud API (official Meta API).
 * No third-party libraries — uses native fetch.
 *
 * Features:
 * - Text messages (send/receive)
 * - Image, audio, video, and document attachments
 * - Reply threading
 * - Read receipts
 * - Interactive buttons and list messages
 * - Template messages for business notifications
 * - Group chat support
 *
 * Setup:
 * 1. Create a Meta Business App at https://developers.facebook.com
 * 2. Add the WhatsApp product
 * 3. Get your Phone Number ID and access token
 * 4. Set up a webhook to receive messages
 *
 * Environment variables:
 *   WHATSAPP_TOKEN         - Permanent access token
 *   WHATSAPP_PHONE_ID      - Phone number ID from Meta dashboard
 *   WHATSAPP_VERIFY_TOKEN  - Webhook verification token (you choose this)
 *   WHATSAPP_WEBHOOK_PORT  - Port for webhook server (default: 3100)
 */

import { createServer, type IncomingMessage as HttpRequest, type ServerResponse } from "node:http";
import type {
  ChannelPlugin,
  IncomingMessageHandler,
  SendOptions,
  PluginContext,
  Attachment,
} from "../../core/types.js";

const GRAPH_API = "https://graph.facebook.com/v21.0";

export class WhatsAppPlugin implements ChannelPlugin {
  name = "whatsapp";
  version = "1.0.0";
  type = "channel" as const;
  description = "WhatsApp Business Cloud API integration";

  private token = "";
  private phoneNumberId = "";
  private verifyToken = "";
  private webhookPort = 3100;
  private handler?: IncomingMessageHandler;
  private server?: ReturnType<typeof createServer>;
  private log!: PluginContext["log"];

  async init(ctx: PluginContext): Promise<void> {
    this.token = process.env["WHATSAPP_TOKEN"] || "";
    this.phoneNumberId = process.env["WHATSAPP_PHONE_ID"] || "";
    this.verifyToken = process.env["WHATSAPP_VERIFY_TOKEN"] || "myclaw-verify";
    this.webhookPort = parseInt(process.env["WHATSAPP_WEBHOOK_PORT"] || "3100", 10);
    this.log = ctx.log;

    if (!this.token || !this.phoneNumberId) {
      ctx.log.warn("WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not set — WhatsApp plugin will not work");
    }
  }

  async listen(handler: IncomingMessageHandler): Promise<void> {
    this.handler = handler;

    this.server = createServer((req, res) => {
      if (req.method === "GET") {
        this.handleVerification(req, res);
      } else if (req.method === "POST") {
        this.handleWebhook(req, res);
      } else {
        res.writeHead(405);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(this.webhookPort, () => {
        this.log.info(`WhatsApp webhook listening on port ${this.webhookPort}`);
        resolve();
      });
    });
  }

  async send(target: string, message: string, opts?: SendOptions): Promise<void> {
    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: target,
      type: "text",
      text: { body: message },
    };

    if (opts?.replyTo) {
      body["context"] = { message_id: opts.replyTo };
    }

    await this.graphApi(`${this.phoneNumberId}/messages`, body);
  }

  /**
   * Send interactive button message (WhatsApp-specific feature).
   */
  async sendButtons(
    target: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>
  ): Promise<void> {
    await this.graphApi(`${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: target,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: buttons.map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    });
  }

  /**
   * Send a list message with selectable options.
   */
  async sendList(
    target: string,
    bodyText: string,
    buttonText: string,
    sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>
  ): Promise<void> {
    await this.graphApi(`${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: target,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText },
        action: {
          button: buttonText,
          sections,
        },
      },
    });
  }

  /**
   * Send media (image, audio, video, document).
   */
  async sendMedia(
    target: string,
    type: "image" | "audio" | "video" | "document",
    url: string,
    caption?: string
  ): Promise<void> {
    const mediaObj: Record<string, unknown> = { link: url };
    if (caption && type !== "audio") {
      mediaObj["caption"] = caption;
    }

    await this.graphApi(`${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: target,
      type,
      [type]: mediaObj,
    });
  }

  /**
   * Send a template message (for notifications outside the 24h window).
   */
  async sendTemplate(
    target: string,
    templateName: string,
    languageCode: string,
    parameters?: Array<{ type: "text"; text: string }>
  ): Promise<void> {
    const template: Record<string, unknown> = {
      name: templateName,
      language: { code: languageCode },
    };

    if (parameters && parameters.length > 0) {
      template["components"] = [
        {
          type: "body",
          parameters,
        },
      ];
    }

    await this.graphApi(`${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: target,
      type: "template",
      template,
    });
  }

  /**
   * Mark a message as read (blue ticks).
   */
  async markRead(messageId: string): Promise<void> {
    await this.graphApi(`${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.log.info("WhatsApp webhook stopped");
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  // ─── Webhook Handlers ──────────────────────────────────────────────────────

  private handleVerification(req: HttpRequest, res: ServerResponse): void {
    const url = new URL(req.url || "", `http://localhost:${this.webhookPort}`);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === this.verifyToken) {
      this.log.info("WhatsApp webhook verified");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(challenge);
    } else {
      this.log.warn("WhatsApp webhook verification failed");
      res.writeHead(403);
      res.end();
    }
  }

  private handleWebhook(req: HttpRequest, res: ServerResponse): void {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      // Always respond 200 quickly to avoid retries
      res.writeHead(200);
      res.end();

      try {
        const payload = JSON.parse(body) as WhatsAppWebhookPayload;
        this.processWebhookPayload(payload);
      } catch (err) {
        this.log.error(`WhatsApp webhook parse error: ${err}`);
      }
    });
  }

  private processWebhookPayload(payload: WhatsAppWebhookPayload): void {
    if (!payload.entry) return;

    for (const entry of payload.entry) {
      for (const change of entry.changes || []) {
        if (change.field !== "messages") continue;

        const value = change.value;
        if (!value?.messages) continue;

        for (const message of value.messages) {
          const contact = value.contacts?.find((c) => c.wa_id === message.from);

          const attachments: Attachment[] = [];

          // Handle media messages
          if (message.type === "image" && message.image) {
            attachments.push({ type: "image", url: message.image.id, mimeType: message.image.mime_type });
          } else if (message.type === "audio" && message.audio) {
            attachments.push({ type: "audio", url: message.audio.id, mimeType: message.audio.mime_type });
          } else if (message.type === "video" && message.video) {
            attachments.push({ type: "video", url: message.video.id, mimeType: message.video.mime_type });
          } else if (message.type === "document" && message.document) {
            attachments.push({
              type: "file",
              url: message.document.id,
              mimeType: message.document.mime_type,
              name: message.document.filename,
            });
          }

          // Extract text content
          let text = "";
          if (message.type === "text" && message.text) {
            text = message.text.body;
          } else if (message.type === "interactive" && message.interactive) {
            // Button reply or list selection
            if (message.interactive.type === "button_reply") {
              text = message.interactive.button_reply?.title || "";
            } else if (message.interactive.type === "list_reply") {
              text = message.interactive.list_reply?.title || "";
            }
          } else if (message.type === "image" && message.image?.caption) {
            text = message.image.caption;
          }

          if ((text || attachments.length > 0) && this.handler) {
            // Mark as read automatically
            this.markRead(message.id).catch(() => {});

            this.handler({
              channelId: "whatsapp",
              userId: message.from,
              userName: contact?.profile?.name || message.from,
              text,
              replyTo: message.id,
              attachments: attachments.length > 0 ? attachments : undefined,
              raw: message,
            });
          }
        }
      }
    }
  }

  /**
   * Download media by ID (for received attachments).
   */
  async downloadMedia(mediaId: string): Promise<Buffer> {
    // Step 1: Get media URL
    const urlRes = await fetch(`${GRAPH_API}/${mediaId}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    const urlData = (await urlRes.json()) as { url?: string };
    if (!urlData.url) throw new Error("Failed to get media URL");

    // Step 2: Download the file
    const mediaRes = await fetch(urlData.url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    return Buffer.from(await mediaRes.arrayBuffer());
  }

  private async graphApi(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${GRAPH_API}/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`WhatsApp API error (${res.status}): ${text}`);
    }

    return res.json();
  }
}

// ─── WhatsApp Webhook Types ────────────────────────────────────────────────

interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      field: string;
      value: {
        messaging_product: string;
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
        messages?: WhatsAppMessage[];
        statuses?: Array<{
          id: string;
          status: "sent" | "delivered" | "read" | "failed";
          recipient_id: string;
        }>;
      };
    }>;
  }>;
}

interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: "text" | "image" | "audio" | "video" | "document" | "interactive" | "reaction" | "sticker" | "location";
  text?: { body: string };
  image?: { id: string; mime_type: string; sha256: string; caption?: string };
  audio?: { id: string; mime_type: string };
  video?: { id: string; mime_type: string; caption?: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
  interactive?: {
    type: "button_reply" | "list_reply";
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  context?: { message_id: string; from: string };
}
