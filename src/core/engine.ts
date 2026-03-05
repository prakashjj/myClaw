/**
 * MyClaw Engine - The Core (~200 lines)
 *
 * This is the heart of MyClaw. It orchestrates plugins, routes messages to
 * agents, and manages the agentic loop. The entire engine is small enough
 * to audit in minutes — unlike OpenClaw's 430K lines.
 *
 * Design wins over competitors:
 * - vs OpenClaw: 200x smaller core, no bloat, same power via plugins
 * - vs PicoClaw: Full TypeScript ecosystem, richer plugin API
 * - vs NanoClaw: No container dependency, process-level sandboxing built in
 * - vs ZeroClaw: Much easier to extend (TS vs Rust), plugin marketplace ready
 * - vs MicroClaw: Simpler mental model, smart routing built into core
 */

import type {
  MyClawConfig,
  Plugin,
  PluginContext,
  ChannelPlugin,
  ToolPlugin,
  ModelPlugin,
  IncomingMessage,
  AgentConfig,
  Message,
  ToolCall,
  Logger,
  MyClawEvent,
} from "./types.js";
import { AuditLogger, AccessControl, RateLimiter } from "./security.js";

type EventHandler = (event: MyClawEvent) => void;

export class MyClawEngine {
  private channels = new Map<string, ChannelPlugin>();
  private tools = new Map<string, ToolPlugin>();
  private models = new Map<string, ModelPlugin>();
  private plugins = new Map<string, Plugin>();
  private agents = new Map<string, AgentConfig>();
  private conversations = new Map<string, Message[]>();
  private eventHandlers: EventHandler[] = [];
  private logger: Logger;

  // Security modules
  private audit?: AuditLogger;
  private accessControl?: AccessControl;
  private rateLimiter?: RateLimiter;

  constructor(private config: MyClawConfig) {
    this.logger = this.createLogger();
    for (const agent of config.agents) {
      this.agents.set(agent.id, agent);
    }

    // Initialize security modules
    if (config.security.auditLog) {
      this.audit = new AuditLogger(config.dataDir || ".myclaw");
      this.audit.init();
    }
    if (config.security.rbac?.enabled) {
      const users = config.security.rbac.users?.map((u) => ({
        userId: u.userId,
        role: u.role,
      }));
      this.accessControl = new AccessControl(undefined, users);
    }
    if (config.security.rateLimiting?.enabled) {
      this.rateLimiter = new RateLimiter(config.security.rateLimiting.windowMs);
    }
  }

  // ─── Plugin Management ──────────────────────────────────────────────────

  async registerPlugin(plugin: Plugin & { type?: string }): Promise<void> {
    const ctx = this.createPluginContext();

    if (plugin.init) {
      await plugin.init(ctx);
    }

    this.plugins.set(plugin.name, plugin);

    if (plugin.type === "channel") {
      const ch = plugin as ChannelPlugin;
      this.channels.set(ch.name, ch);
      await ch.listen((msg) => this.handleIncoming(msg));
    } else if (plugin.type === "tool") {
      this.tools.set(plugin.name, plugin as ToolPlugin);
    } else if (plugin.type === "model") {
      this.models.set(plugin.name, plugin as ModelPlugin);
    }

    this.emit({ type: "plugin.loaded", data: { name: plugin.name } });
    this.logger.info(`Plugin loaded: ${plugin.name}`);
  }

  // ─── Message Handling ───────────────────────────────────────────────────

  private async handleIncoming(msg: IncomingMessage): Promise<void> {
    this.emit({ type: "message.received", data: msg });

    // ─── Security Checks ──────────────────────────────────────────────────
    // Rate limiting
    if (this.rateLimiter) {
      const limit = this.accessControl?.getRateLimit(msg.userId) ||
        this.config.security.rateLimiting?.defaultLimit || 30;
      const check = this.rateLimiter.check(msg.userId, limit);
      if (!check.allowed) {
        this.emit({ type: "security.rate_limited", data: { userId: msg.userId, retryAfterMs: check.retryAfterMs || 0 } });
        this.audit?.log(msg.userId, "rate.limited", msg.channelId, "denied", { remaining: check.remaining });
        this.logger.warn(`Rate limited user ${msg.userId} (retry in ${check.retryAfterMs}ms)`);
        return;
      }
    }

    // Channel access check
    if (this.accessControl && !this.accessControl.canAccessChannel(msg.userId, msg.channelId)) {
      this.emit({ type: "security.denied", data: { userId: msg.userId, action: "channel.access", reason: "Channel not allowed" } });
      this.audit?.log(msg.userId, "auth.denied", msg.channelId, "denied", { reason: "channel access" });
      return;
    }

    // Audit incoming message
    this.audit?.log(msg.userId, "message.received", msg.channelId, "success", { text: msg.text.slice(0, 200) });

    const agent = this.resolveAgent(msg);
    if (!agent) {
      this.logger.warn(`No agent configured for channel: ${msg.channelId}`);
      return;
    }

    const convKey = `${msg.channelId}:${msg.groupId || msg.userId}`;
    const history = this.conversations.get(convKey) || [];

    history.push({
      role: "user",
      content: msg.text,
      timestamp: Date.now(),
    });

    try {
      const response = await this.runAgentLoop(agent, history);

      history.push({
        role: "assistant",
        content: response,
        timestamp: Date.now(),
      });

      // Trim conversation history based on memory config
      const limit = agent.memory?.shortTermLimit || 50;
      if (history.length > limit) {
        history.splice(0, history.length - limit);
      }
      this.conversations.set(convKey, history);

      // Send response back through the channel
      const channel = this.channels.get(msg.channelId);
      if (channel) {
        await channel.send(msg.groupId || msg.userId, response, {
          replyTo: msg.replyTo,
        });
        this.emit({
          type: "message.sent",
          data: { channelId: msg.channelId, target: msg.userId, text: response },
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Agent error: ${errorMsg}`);
      this.emit({ type: "agent.error", data: { agentId: agent.id, error: errorMsg } });
    }
  }

  // ─── Agentic Loop ──────────────────────────────────────────────────────

  private async runAgentLoop(agent: AgentConfig, history: Message[]): Promise<string> {
    const model = this.resolveModel(agent);
    if (!model) {
      throw new Error(`No model provider found for: ${agent.model}`);
    }

    const availableTools = this.getAgentTools(agent);
    const maxTurns = agent.maxTurns || 10;
    let modelId = agent.model;

    // Smart routing: use cheaper model for simple messages
    if (agent.smartRouting?.enabled) {
      const lastMsg = history[history.length - 1];
      if (lastMsg && this.isSimpleMessage(lastMsg.content)) {
        modelId = agent.smartRouting.cheapModel;
        this.logger.debug(`Smart routing: using ${modelId} for simple message`);
      }
    }

    this.emit({ type: "agent.thinking", data: { agentId: agent.id, model: modelId } });

    let response = await model.chat({
      model: modelId,
      messages: history,
      tools: availableTools.flatMap((t) => t.tools),
      systemPrompt: agent.systemPrompt,
    });

    let turns = 0;
    while (response.finishReason === "tool_use" && response.toolCalls && turns < maxTurns) {
      turns++;
      const toolResults = await this.executeToolCalls(agent, response.toolCalls);

      history.push({
        role: "assistant",
        content: response.content || "",
        metadata: { toolCalls: response.toolCalls },
        timestamp: Date.now(),
      });

      for (const result of toolResults) {
        history.push({
          role: "tool",
          content: result,
          timestamp: Date.now(),
        });
      }

      response = await model.chat({
        model: modelId,
        messages: history,
        tools: availableTools.flatMap((t) => t.tools),
        systemPrompt: agent.systemPrompt,
      });
    }

    this.emit({ type: "agent.response", data: { agentId: agent.id, content: response.content } });
    return response.content;
  }

  private async executeToolCalls(agent: AgentConfig, toolCalls: ToolCall[]): Promise<string[]> {
    const results: string[] = [];

    for (const call of toolCalls) {
      this.emit({
        type: "agent.tool_call",
        data: { agentId: agent.id, tool: call.name, args: call.args },
      });

      const toolPlugin = this.findToolByName(call.name);
      if (!toolPlugin) {
        results.push(`Error: Tool "${call.name}" not found`);
        continue;
      }

      // Check if agent is allowed to use this tool
      if (agent.allowedTools && !agent.allowedTools.includes(call.name)) {
        results.push(`Error: Agent "${agent.id}" is not allowed to use tool "${call.name}"`);
        this.audit?.log(agent.id, "tool.denied", call.name, "denied", { reason: "agent allowedTools" });
        continue;
      }

      try {
        this.audit?.log(agent.id, "tool.execute", call.name, "success", { args: call.args });
        const result = await toolPlugin.execute(call.name, call.args);
        results.push(result.success ? result.output : `Error: ${result.error}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push(`Error executing ${call.name}: ${errMsg}`);
      }
    }

    return results;
  }

  // ─── Smart Routing ─────────────────────────────────────────────────────

  private isSimpleMessage(text: string): boolean {
    // Simple heuristic: short messages without complex keywords are "simple"
    const complexIndicators = [
      "analyze", "compare", "explain", "implement", "design",
      "debug", "refactor", "review", "plan", "research",
    ];
    if (text.length > 200) return false;
    const lower = text.toLowerCase();
    return !complexIndicators.some((word) => lower.includes(word));
  }

  // ─── Resolution Helpers ─────────────────────────────────────────────────

  private resolveAgent(msg: IncomingMessage): AgentConfig | undefined {
    // Find agent configured for this channel
    for (const agent of this.agents.values()) {
      if (!agent.channels || agent.channels.includes(msg.channelId)) {
        return agent;
      }
    }
    return this.agents.values().next().value; // fallback to first agent
  }

  private resolveModel(agent: AgentConfig): ModelPlugin | undefined {
    const [provider] = agent.model.split("/");
    return this.models.get(provider) || this.models.values().next().value;
  }

  private getAgentTools(agent: AgentConfig): ToolPlugin[] {
    if (!agent.allowedTools) {
      return [...this.tools.values()];
    }
    return [...this.tools.values()].filter((t) =>
      t.tools.some((td) => agent.allowedTools!.includes(td.name))
    );
  }

  private findToolByName(name: string): ToolPlugin | undefined {
    for (const toolPlugin of this.tools.values()) {
      if (toolPlugin.tools.some((t) => t.name === name)) {
        return toolPlugin;
      }
    }
    return undefined;
  }

  // ─── Events ─────────────────────────────────────────────────────────────

  on(handler: EventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
    };
  }

  private emit(event: MyClawEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Don't let event handler errors crash the engine
      }
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    this.logger.info("Shutting down MyClaw...");
    for (const ch of this.channels.values()) {
      await ch.stop();
    }
    for (const plugin of this.plugins.values()) {
      if (plugin.destroy) {
        await plugin.destroy();
      }
    }
    // Cleanup security modules
    await this.audit?.destroy();
    this.rateLimiter?.destroy();
    this.logger.info("MyClaw stopped.");
  }

  // ─── Utilities ──────────────────────────────────────────────────────────

  private createPluginContext(): PluginContext {
    return {
      config: this.config,
      emit: (event: string, data: unknown) =>
        this.emit({ type: event, data } as MyClawEvent),
      log: this.logger,
      getPlugin: <T extends Plugin>(name: string) => this.plugins.get(name) as T | undefined,
    };
  }

  private createLogger(): Logger {
    const level = this.config.logging?.level || "info";
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    const threshold = levels[level];
    const prefix = "[MyClaw]";

    const shouldLog = (l: keyof typeof levels) => levels[l] >= threshold;

    return {
      debug: (msg, ...args) => shouldLog("debug") && console.debug(`${prefix} ${msg}`, ...args),
      info: (msg, ...args) => shouldLog("info") && console.info(`${prefix} ${msg}`, ...args),
      warn: (msg, ...args) => shouldLog("warn") && console.warn(`${prefix} ${msg}`, ...args),
      error: (msg, ...args) => shouldLog("error") && console.error(`${prefix} ${msg}`, ...args),
    };
  }

  /**
   * Process a message directly (for CLI / programmatic use).
   * Unlike handleIncoming(), this is public and returns the response text.
   */
  async processMessage(text: string, userId = "cli-user", channelId = "cli"): Promise<string> {
    const msg: IncomingMessage = {
      channelId,
      userId,
      userName: userId,
      text,
    };

    // Rate limiting
    if (this.rateLimiter) {
      const limit = this.accessControl?.getRateLimit(msg.userId) ||
        this.config.security.rateLimiting?.defaultLimit || 30;
      const check = this.rateLimiter.check(msg.userId, limit);
      if (!check.allowed) {
        return `Rate limited. Try again in ${Math.ceil((check.retryAfterMs || 0) / 1000)}s.`;
      }
    }

    const agent = this.resolveAgent(msg);
    if (!agent) {
      return "No agent configured.";
    }

    const convKey = `${channelId}:${userId}`;
    const history = this.conversations.get(convKey) || [];

    history.push({ role: "user", content: text, timestamp: Date.now() });

    try {
      const response = await this.runAgentLoop(agent, history);
      history.push({ role: "assistant", content: response, timestamp: Date.now() });

      const limit = agent.memory?.shortTermLimit || 50;
      if (history.length > limit) {
        history.splice(0, history.length - limit);
      }
      this.conversations.set(convKey, history);

      return response;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Agent error: ${errorMsg}`);
      return `Error: ${errorMsg}`;
    }
  }

  getStatus(): { plugins: string[]; agents: string[]; channels: string[]; tools: string[] } {
    return {
      plugins: [...this.plugins.keys()],
      agents: [...this.agents.keys()],
      channels: [...this.channels.keys()],
      tools: [...this.tools.values()].flatMap((t) => t.tools.map((td) => td.name)),
    };
  }
}
