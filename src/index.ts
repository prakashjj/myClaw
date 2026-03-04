/**
 * MyClaw — The Superior AI Agent Platform
 *
 * Public API for programmatic usage.
 */

// Core
export { MyClawEngine } from "./core/engine.js";
export type {
  // Messages
  Message,
  Conversation,
  // Plugins
  Plugin,
  PluginContext,
  ChannelPlugin,
  ToolPlugin,
  ModelPlugin,
  // Tools
  ToolDefinition,
  ToolResult,
  ParameterDef,
  // Models
  ModelInfo,
  ModelCapability,
  ChatRequest,
  ChatResponse,
  ChatChunk,
  ToolCall,
  TokenUsage,
  // Channels
  IncomingMessage,
  IncomingMessageHandler,
  SendOptions,
  Attachment,
  // Agents
  AgentConfig,
  SmartRoutingConfig,
  MemoryConfig,
  // Config
  MyClawConfig,
  SecurityConfig,
  LogConfig,
  Logger,
  // Events
  MyClawEvent,
} from "./core/types.js";

// Performance
export {
  ResponseCache,
  RequestDeduplicator,
  parallelExecute,
  optimizeTokenBudget,
} from "./core/performance.js";

// Security
export { Sandbox } from "./core/sandbox.js";

// Agents
export { AgentSwarm } from "./agents/swarm.js";
export type { SwarmConfig, SwarmTask, SwarmResult } from "./agents/swarm.js";
export { TaskScheduler } from "./agents/scheduler.js";
export type { ScheduledTask } from "./agents/scheduler.js";

// Built-in Plugins
export { AnthropicPlugin } from "./plugins/models/anthropic.js";
export { OpenAIPlugin } from "./plugins/models/openai.js";
export { TelegramPlugin } from "./plugins/channels/telegram.js";
export { DiscordPlugin } from "./plugins/channels/discord.js";
export { SlackPlugin } from "./plugins/channels/slack.js";
export { ShellToolPlugin } from "./plugins/tools/shell.js";
export { WebToolPlugin } from "./plugins/tools/web.js";
export { FilesystemToolPlugin } from "./plugins/tools/filesystem.js";
export { MemoryToolPlugin } from "./plugins/tools/memory.js";
export { BrowserToolPlugin } from "./plugins/tools/browser.js";
export { CodeInterpreterPlugin } from "./plugins/tools/codeinterpreter.js";
export { WorkflowToolPlugin } from "./plugins/tools/workflow.js";

// Config
export { loadConfig, generateDefaultConfig } from "./config/loader.js";
