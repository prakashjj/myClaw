/**
 * Telegram Channel Plugin
 *
 * Connects MyClaw to Telegram using the Bot API.
 * No external dependencies — uses native fetch (Node 20+).
 *
 * Compared to OpenClaw's Telegram integration which is buried in 430K lines
 * of code, this is a self-contained, auditable plugin.
 */

import type {
  ChannelPlugin,
  IncomingMessageHandler,
  SendOptions,
  PluginContext,
} from "../../core/types.js";

export class TelegramPlugin implements ChannelPlugin {
  name = "telegram";
  version = "1.0.0";
  type = "channel" as const;
  description = "Telegram Bot integration";

  private token = "";
  private handler?: IncomingMessageHandler;
  private polling = false;
  private offset = 0;
  private pollTimeout: ReturnType<typeof setTimeout> | null = null;
  private log!: PluginContext["log"];

  async init(ctx: PluginContext): Promise<void> {
    this.token = process.env["TELEGRAM_BOT_TOKEN"] || "";
    this.log = ctx.log;
    if (!this.token) {
      ctx.log.warn("TELEGRAM_BOT_TOKEN not set — Telegram plugin will not work");
    }
  }

  async listen(handler: IncomingMessageHandler): Promise<void> {
    this.handler = handler;
    this.polling = true;
    this.poll();
    this.log.info("Telegram polling started");
  }

  async send(target: string, message: string, opts?: SendOptions): Promise<void> {
    const body: Record<string, unknown> = {
      chat_id: target,
      text: message,
    };

    if (opts?.format === "markdown") {
      body["parse_mode"] = "MarkdownV2";
    } else if (opts?.format === "html") {
      body["parse_mode"] = "HTML";
    }

    if (opts?.replyTo) {
      body["reply_to_message_id"] = parseInt(opts.replyTo, 10);
    }

    await this.api("sendMessage", body);
  }

  async stop(): Promise<void> {
    this.polling = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
    }
    this.log.info("Telegram polling stopped");
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private async poll(): Promise<void> {
    if (!this.polling) return;

    try {
      const data = await this.api("getUpdates", {
        offset: this.offset,
        timeout: 30,
      });

      if (data.result && Array.isArray(data.result)) {
        for (const update of data.result) {
          this.offset = update.update_id + 1;

          if (update.message?.text && this.handler) {
            await this.handler({
              channelId: "telegram",
              userId: String(update.message.from?.id || ""),
              userName: update.message.from?.username || update.message.from?.first_name || "",
              groupId: update.message.chat.type !== "private"
                ? String(update.message.chat.id)
                : undefined,
              text: update.message.text,
              replyTo: String(update.message.message_id),
            });
          }
        }
      }
    } catch (err) {
      this.log.error(`Telegram poll error: ${err instanceof Error ? err.message : err}`);
    }

    // Schedule next poll
    if (this.polling) {
      this.pollTimeout = setTimeout(() => this.poll(), 100);
    }
  }

  private async api(method: string, body?: Record<string, unknown>): Promise<TelegramApiResponse> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Telegram API error (${res.status}): ${text}`);
    }

    return res.json() as Promise<TelegramApiResponse>;
  }
}

interface TelegramApiResponse {
  ok: boolean;
  result?: unknown[];
}
