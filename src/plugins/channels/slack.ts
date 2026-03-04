/**
 * Slack Channel Plugin
 *
 * Connects MyClaw to Slack using Socket Mode (WebSocket).
 * No need for a public URL or HTTP server — works behind firewalls.
 */

import type {
  ChannelPlugin,
  IncomingMessageHandler,
  SendOptions,
  PluginContext,
} from "../../core/types.js";

export class SlackPlugin implements ChannelPlugin {
  name = "slack";
  version = "1.0.0";
  type = "channel" as const;
  description = "Slack Bot integration via Socket Mode";

  private botToken = "";
  private appToken = "";
  private handler?: IncomingMessageHandler;
  private ws: WebSocket | null = null;
  private botUserId = "";
  private log!: PluginContext["log"];

  async init(ctx: PluginContext): Promise<void> {
    this.botToken = process.env["SLACK_BOT_TOKEN"] || "";
    this.appToken = process.env["SLACK_APP_TOKEN"] || "";
    this.log = ctx.log;
    if (!this.botToken || !this.appToken) {
      ctx.log.warn("SLACK_BOT_TOKEN/SLACK_APP_TOKEN not set — Slack plugin will not work");
    }
  }

  async listen(handler: IncomingMessageHandler): Promise<void> {
    this.handler = handler;

    // Get bot user ID
    const authRes = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${this.botToken}` },
    });
    const authData = (await authRes.json()) as { user_id?: string };
    this.botUserId = authData.user_id || "";

    // Connect via Socket Mode
    const wsRes = await fetch("https://slack.com/api/apps.connections.open", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.appToken}` },
    });
    const wsData = (await wsRes.json()) as { url?: string };
    if (!wsData.url) throw new Error("Failed to get Slack WebSocket URL");

    this.ws = new WebSocket(wsData.url);

    this.ws.onmessage = (event: MessageEvent) => {
      const payload = JSON.parse(String(event.data));
      this.handleEvent(payload);
    };

    this.ws.onerror = (err) => {
      this.log.error(`Slack WebSocket error: ${err}`);
    };

    this.ws.onclose = () => {
      this.log.warn("Slack WebSocket closed, reconnecting in 5s...");
      setTimeout(() => this.listen(handler), 5000);
    };

    this.log.info("Slack Socket Mode connected");
  }

  async send(target: string, message: string, opts?: SendOptions): Promise<void> {
    const body: Record<string, unknown> = {
      channel: target,
      text: message,
    };

    if (opts?.replyTo) {
      body["thread_ts"] = opts.replyTo;
    }

    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify(body),
    });
  }

  async stop(): Promise<void> {
    if (this.ws) this.ws.close();
    this.log.info("Slack disconnected");
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private handleEvent(payload: Record<string, unknown>): void {
    // Acknowledge envelope
    if (payload["envelope_id"]) {
      this.ws?.send(JSON.stringify({ envelope_id: payload["envelope_id"] }));
    }

    const eventPayload = payload["payload"] as Record<string, unknown> | undefined;
    if (!eventPayload) return;

    const event = eventPayload["event"] as Record<string, string> | undefined;
    if (!event) return;

    // Handle messages
    if (event["type"] === "message" && !event["subtype"] && event["user"] !== this.botUserId) {
      this.handler?.({
        channelId: "slack",
        userId: event["user"] || "",
        groupId: event["channel"] || "",
        text: event["text"] || "",
        replyTo: event["ts"],
      });
    }
  }
}
