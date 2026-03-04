/**
 * MyClaw Core Types
 *
 * The entire type system for MyClaw fits in a single file.
 * Compare: OpenClaw has 53 config files. MyClaw has one types file.
 */

// ─── Messages ───────────────────────────────────────────────────────────────

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** Optional structured data (tool results, images, etc.) */
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface Conversation {
  id: string;
  messages: Message[];
  channelId: string;
  userId: string;
  agentId: string;
  createdAt: number;
  updatedAt: number;
}

// ─── Plugins ────────────────────────────────────────────────────────────────

export interface Plugin {
  name: string;
  version: string;
  description?: string;
  init?(ctx: PluginContext): Promise<void>;
  destroy?(): Promise<void>;
}

export interface PluginContext {
  config: MyClawConfig;
  emit: (event: string, data: unknown) => void;
  log: Logger;
  getPlugin: <T extends Plugin>(name: string) => T | undefined;
}

// ─── Channels (messaging platforms) ─────────────────────────────────────────

export interface ChannelPlugin extends Plugin {
  type: "channel";
  /** Start listening for incoming messages */
  listen(handler: IncomingMessageHandler): Promise<void>;
  /** Send a message to a user/group on this channel */
  send(target: string, message: string, opts?: SendOptions): Promise<void>;
  /** Stop listening */
  stop(): Promise<void>;
}

export type IncomingMessageHandler = (msg: IncomingMessage) => Promise<void>;

export interface IncomingMessage {
  channelId: string;
  userId: string;
  userName?: string;
  groupId?: string;
  text: string;
  replyTo?: string;
  attachments?: Attachment[];
  raw?: unknown;
}

export interface Attachment {
  type: "image" | "audio" | "video" | "file";
  url?: string;
  data?: Buffer;
  mimeType?: string;
  name?: string;
}

export interface SendOptions {
  replyTo?: string;
  format?: "text" | "markdown" | "html";
}

// ─── Tools (capabilities) ──────────────────────────────────────────────────

export interface ToolPlugin extends Plugin {
  type: "tool";
  tools: ToolDefinition[];
  execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ParameterDef>;
  /** If true, tool runs in sandbox */
  sandboxed?: boolean;
}

export interface ParameterDef {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  default?: unknown;
}

export interface ToolResult {
  success: boolean;
  output: string;
  data?: unknown;
  error?: string;
}

// ─── Model Providers ────────────────────────────────────────────────────────

export interface ModelPlugin extends Plugin {
  type: "model";
  provider: string;
  models: ModelInfo[];
  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream?(request: ChatRequest): AsyncIterable<ChatChunk>;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  /** Cost per million input tokens in USD */
  inputCostPerM?: number;
  /** Cost per million output tokens in USD */
  outputCostPerM?: number;
  capabilities: ModelCapability[];
}

export type ModelCapability = "chat" | "vision" | "tools" | "code" | "reasoning";

export interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  finishReason: "stop" | "tool_use" | "length" | "error";
}

export interface ChatChunk {
  content?: string;
  toolCalls?: ToolCall[];
  done: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// ─── Agents ─────────────────────────────────────────────────────────────────

export interface AgentConfig {
  id: string;
  name: string;
  description?: string;
  /** Model to use (vendor/model format, e.g. "anthropic/claude-sonnet-4-20250514") */
  model: string;
  /** System prompt for this agent */
  systemPrompt: string;
  /** Which tools this agent can access */
  allowedTools?: string[];
  /** Which channels this agent listens on */
  channels?: string[];
  /** Max turns in an agentic loop before stopping */
  maxTurns?: number;
  /** Route simple messages to a cheaper model */
  smartRouting?: SmartRoutingConfig;
  /** Memory config */
  memory?: MemoryConfig;
}

export interface SmartRoutingConfig {
  enabled: boolean;
  /** Model for simple/classification tasks */
  cheapModel: string;
  /** Complexity threshold (0-1) above which the main model is used */
  complexityThreshold: number;
}

export interface MemoryConfig {
  enabled: boolean;
  /** Max messages to keep in short-term context */
  shortTermLimit: number;
  /** Whether to persist long-term memories */
  longTerm: boolean;
  /** Storage backend for long-term memory */
  storage?: "file" | "sqlite";
}

// ─── Configuration ──────────────────────────────────────────────────────────

export interface MyClawConfig {
  /** Agent definitions */
  agents: AgentConfig[];
  /** Plugin packages to load */
  plugins?: string[];
  /** Global security settings */
  security: SecurityConfig;
  /** Logging configuration */
  logging?: LogConfig;
  /** Data directory for persistence */
  dataDir?: string;
}

export interface SecurityConfig {
  /** Sandbox mode: "process" (fork), "container" (Docker/Apple Container), "none" */
  sandbox: "process" | "container" | "none";
  /** Allowed filesystem paths for tool execution */
  allowedPaths?: string[];
  /** Network access allowed? */
  networkAccess: boolean;
  /** Max execution time for tool calls (ms) */
  maxExecutionTime: number;
  /** Max memory for sandboxed processes (MB) */
  maxMemoryMB: number;
}

export interface LogConfig {
  level: "debug" | "info" | "warn" | "error";
  file?: string;
}

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

// ─── Events ─────────────────────────────────────────────────────────────────

export type MyClawEvent =
  | { type: "message.received"; data: IncomingMessage }
  | { type: "message.sent"; data: { channelId: string; target: string; text: string } }
  | { type: "agent.thinking"; data: { agentId: string; model: string } }
  | { type: "agent.tool_call"; data: { agentId: string; tool: string; args: Record<string, unknown> } }
  | { type: "agent.response"; data: { agentId: string; content: string } }
  | { type: "agent.error"; data: { agentId: string; error: string } }
  | { type: "plugin.loaded"; data: { name: string } }
  | { type: "plugin.error"; data: { name: string; error: string } };
