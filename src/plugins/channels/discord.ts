/**
 * Discord Channel Plugin
 *
 * Connects MyClaw to Discord using the Gateway WebSocket API.
 * Zero external dependencies — uses native WebSocket (Node 22+) and fetch.
 */

import type {
  ChannelPlugin,
  IncomingMessageHandler,
  SendOptions,
  PluginContext,
} from "../../core/types.js";

export class DiscordPlugin implements ChannelPlugin {
  name = "discord";
  version = "1.0.0";
  type = "channel" as const;
  description = "Discord Bot integration";

  private token = "";
  private handler?: IncomingMessageHandler;
  private ws: WebSocket | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private sequenceNumber: number | null = null;
  private botUserId = "";
  private log!: PluginContext["log"];
  private baseUrl = "https://discord.com/api/v10";

  async init(ctx: PluginContext): Promise<void> {
    this.token = process.env["DISCORD_BOT_TOKEN"] || "";
    this.log = ctx.log;
    if (!this.token) {
      ctx.log.warn("DISCORD_BOT_TOKEN not set — Discord plugin will not work");
    }
  }

  async listen(handler: IncomingMessageHandler): Promise<void> {
    this.handler = handler;
    await this.connect();
    this.log.info("Discord gateway connected");
  }

  async send(target: string, message: string, _opts?: SendOptions): Promise<void> {
    await fetch(`${this.baseUrl}/channels/${target}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${this.token}`,
      },
      body: JSON.stringify({ content: message }),
    });
  }

  async stop(): Promise<void> {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.ws) this.ws.close();
    this.log.info("Discord gateway disconnected");
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private async connect(): Promise<void> {
    // Get gateway URL
    const res = await fetch(`${this.baseUrl}/gateway/bot`, {
      headers: { Authorization: `Bot ${this.token}` },
    });
    const data = (await res.json()) as { url: string };
    const gatewayUrl = `${data.url}?v=10&encoding=json`;

    this.ws = new WebSocket(gatewayUrl);

    this.ws.onmessage = (event: MessageEvent) => {
      const payload = JSON.parse(String(event.data)) as DiscordPayload;
      this.handlePayload(payload);
    };

    this.ws.onclose = () => {
      this.log.warn("Discord gateway closed, reconnecting in 5s...");
      if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
      setTimeout(() => this.connect(), 5000);
    };

    this.ws.onerror = (err) => {
      this.log.error(`Discord gateway error: ${err}`);
    };
  }

  private handlePayload(payload: DiscordPayload): void {
    if (payload.s) this.sequenceNumber = payload.s;

    switch (payload.op) {
      case 10: // Hello
        this.startHeartbeat(payload.d.heartbeat_interval as number);
        this.identify();
        break;
      case 11: // Heartbeat ACK
        break;
      case 0: // Dispatch
        this.handleDispatch(payload);
        break;
    }
  }

  private handleDispatch(payload: DiscordPayload): void {
    if (payload.t === "READY") {
      this.botUserId = payload.d.user?.id || "";
      this.log.info(`Discord bot ready as ${payload.d.user?.username}`);
    }

    if (payload.t === "MESSAGE_CREATE" && this.handler) {
      const msg = payload.d;
      // Ignore own messages
      if (msg.author?.id === this.botUserId) return;
      // Ignore bot messages
      if (msg.author?.bot) return;

      this.handler({
        channelId: "discord",
        userId: msg.author?.id || "",
        userName: msg.author?.username || "",
        groupId: msg.channel_id,
        text: msg.content || "",
        replyTo: msg.id,
      });
    }
  }

  private identify(): void {
    this.ws?.send(
      JSON.stringify({
        op: 2,
        d: {
          token: this.token,
          intents: 33281, // GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
          properties: {
            os: "linux",
            browser: "myclaw",
            device: "myclaw",
          },
        },
      })
    );
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      this.ws?.send(JSON.stringify({ op: 1, d: this.sequenceNumber }));
    }, intervalMs);
  }
}

interface DiscordPayload {
  op: number;
  d: Record<string, unknown> & {
    heartbeat_interval?: number;
    user?: { id: string; username: string };
    author?: { id: string; username: string; bot?: boolean };
    content?: string;
    channel_id?: string;
    id?: string;
  };
  s?: number;
  t?: string;
}
