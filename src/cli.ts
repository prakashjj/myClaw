#!/usr/bin/env node

/**
 * MyClaw CLI
 *
 * The primary interface for MyClaw. Designed for minimal friction:
 * - `myclaw` — starts the agent with auto-detected config
 * - `myclaw init` — generates a config file
 * - `myclaw chat` — interactive chat in the terminal
 * - `myclaw status` — show loaded plugins and agents
 * - `myclaw run <prompt>` — run a one-shot agent task
 *
 * Unlike OpenClaw's 45-minute setup process, MyClaw gets you running
 * in under 60 seconds.
 */

import { MyClawEngine } from "./core/engine.js";
import { loadConfig, generateDefaultConfig } from "./config/loader.js";
import { AnthropicPlugin } from "./plugins/models/anthropic.js";
import { OpenAIPlugin } from "./plugins/models/openai.js";
import { TelegramPlugin } from "./plugins/channels/telegram.js";
import { DiscordPlugin } from "./plugins/channels/discord.js";
import { SlackPlugin } from "./plugins/channels/slack.js";
import { ShellToolPlugin } from "./plugins/tools/shell.js";
import { WebToolPlugin } from "./plugins/tools/web.js";
import { FilesystemToolPlugin } from "./plugins/tools/filesystem.js";
import { MemoryToolPlugin } from "./plugins/tools/memory.js";
import { BrowserToolPlugin } from "./plugins/tools/browser.js";
import { CodeInterpreterPlugin } from "./plugins/tools/codeinterpreter.js";
import { WorkflowToolPlugin } from "./plugins/tools/workflow.js";
import { VoiceToolPlugin } from "./plugins/tools/voice.js";
import { InsightsToolPlugin } from "./plugins/tools/insights.js";
import { WhatsAppPlugin } from "./plugins/channels/whatsapp.js";
import { validateInstallation, secureMyClaw } from "./core/security.js";
import { OpenRouterPlugin } from "./plugins/models/openrouter.js";
import { IS_WINDOWS, getPathSeparator } from "./core/platform.js";
import { WebhookServer } from "./core/webhook.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

const VERSION = "1.0.0";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || "start";

  switch (command) {
    case "init":
      await initCommand();
      break;
    case "chat":
      await chatCommand();
      break;
    case "run":
      await runCommand(args.slice(1).join(" "));
      break;
    case "status":
      await statusCommand();
      break;
    case "start":
      await startCommand();
      break;
    case "secure":
    case "security-check":
      await secureCommand();
      break;
    case "version":
    case "--version":
    case "-v":
      console.log(`MyClaw v${VERSION}`);
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      // Treat unknown commands as a "run" prompt
      await runCommand(args.join(" "));
  }
}

function printHelp(): void {
  console.log(`
MyClaw v${VERSION} — The Superior AI Agent Platform

Usage: myclaw [command] [options]

Commands:
  start          Start MyClaw daemon (listens on configured channels)
  init           Generate a default config file
  chat           Interactive chat in the terminal
  run <prompt>   Run a one-shot agent task
  status         Show loaded plugins and agent status
  secure         Run security audit of your installation
  version        Show version
  help           Show this help

Environment Variables:
  ANTHROPIC_API_KEY     Anthropic API key (required for Claude models)
  OPENAI_API_KEY        OpenAI API key (for GPT models)
  OPENROUTER_API_KEY    OpenRouter API key (access 300+ models with one key)
  TELEGRAM_BOT_TOKEN    Telegram bot token
  DISCORD_BOT_TOKEN     Discord bot token
  SLACK_BOT_TOKEN       Slack bot token
  SLACK_APP_TOKEN       Slack app-level token (for Socket Mode)
  WHATSAPP_TOKEN        WhatsApp Business Cloud API token
  WHATSAPP_PHONE_ID     WhatsApp phone number ID
  MYCLAW_MODEL          Default model (default: anthropic/claude-sonnet-4-20250514)
  MYCLAW_CHEAP_MODEL    Model for smart routing (default: anthropic/claude-haiku-4-5-20251001)
  MYCLAW_SANDBOX        Sandbox mode: process, container, none (default: process)
  MYCLAW_LOG_LEVEL      Log level: debug, info, warn, error (default: info)

Examples:
  myclaw init                          Create config file
  myclaw chat                          Start interactive chat
  myclaw run "summarize my emails"     One-shot task
  myclaw start                         Start daemon mode
  myclaw secure                        Audit security posture
  myclaw secure --fix                  Auto-fix folder permissions
`);
}

async function initCommand(): Promise<void> {
  const configContent = generateDefaultConfig();
  const configPath = "myclaw.json";

  await writeFile(configPath, configContent, "utf-8");
  await mkdir(".myclaw", { recursive: true });

  console.log(`Created ${configPath} with default configuration.`);
  console.log(`Created .myclaw/ directory for data storage.`);
  console.log(`\nNext steps:`);
  console.log(`  1. Set your API key: export ANTHROPIC_API_KEY=sk-...`);
  console.log(`  2. Edit ${configPath} to customize your agent`);
  console.log(`  3. Run: myclaw chat`);
}

async function chatCommand(): Promise<void> {
  const config = await loadConfig();
  const engine = new MyClawEngine(config);

  await registerDefaultPlugins(engine, config);

  console.log(`\nMyClaw v${VERSION} — Interactive Chat`);
  console.log(`Type your message and press Enter. Type "exit" to quit.\n`);

  const status = engine.getStatus();
  console.log(`Loaded: ${status.agents.length} agent(s), ${status.tools.length} tool(s)\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "You: ",
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    if (input === "exit" || input === "quit") {
      console.log("Goodbye!");
      await engine.shutdown();
      process.exit(0);
    }
    if (input === "/status") {
      const s = engine.getStatus();
      console.log(`Agents: ${s.agents.join(", ")}`);
      console.log(`Tools: ${s.tools.join(", ")}`);
      console.log(`Channels: ${s.channels.join(", ") || "(none)"}`);
      rl.prompt();
      return;
    }

    // Process through engine
    try {
      const response = await engine.processMessage(input);
      console.log(`\nMyClaw: ${response}\n`);
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : err}\n`);
    }
    rl.prompt();
  });

  rl.on("close", async () => {
    await engine.shutdown();
    process.exit(0);
  });
}

async function runCommand(prompt: string): Promise<void> {
  if (!prompt) {
    console.error("Usage: myclaw run <prompt>");
    process.exit(1);
  }

  const config = await loadConfig();
  const engine = new MyClawEngine(config);
  await registerDefaultPlugins(engine, config);

  console.log(`Running: ${prompt}\n`);

  const response = await engine.processMessage(prompt);
  console.log(response);

  await engine.shutdown();
}

async function statusCommand(): Promise<void> {
  const config = await loadConfig();
  const engine = new MyClawEngine(config);
  await registerDefaultPlugins(engine, config);

  const status = engine.getStatus();

  console.log(`MyClaw v${VERSION} Status\n`);
  console.log(`Agents (${status.agents.length}):`);
  for (const a of status.agents) {
    console.log(`  - ${a}`);
  }
  console.log(`\nPlugins (${status.plugins.length}):`);
  for (const p of status.plugins) {
    console.log(`  - ${p}`);
  }
  console.log(`\nTools (${status.tools.length}):`);
  for (const t of status.tools) {
    console.log(`  - ${t}`);
  }
  console.log(`\nChannels (${status.channels.length}):`);
  for (const c of status.channels) {
    console.log(`  - ${c}`);
  }
  console.log(`\nSecurity: sandbox=${config.security.sandbox}, network=${config.security.networkAccess}`);

  await engine.shutdown();
}

async function startCommand(): Promise<void> {
  const config = await loadConfig();
  const engine = new MyClawEngine(config);
  await registerDefaultPlugins(engine, config);

  const status = engine.getStatus();

  console.log(`MyClaw v${VERSION} started`);
  console.log(`  Agents: ${status.agents.join(", ")}`);
  console.log(`  Channels: ${status.channels.join(", ") || "(none — use 'myclaw chat' for terminal)"}`);
  console.log(`  Tools: ${status.tools.length} loaded`);
  console.log(`\nListening for messages... (Ctrl+C to stop)\n`);

  // Event logging
  engine.on((event) => {
    switch (event.type) {
      case "message.received": {
        const data = event.data as { channelId: string; userId: string; text: string };
        console.log(`[${data.channelId}] ${data.userId}: ${data.text}`);
        break;
      }
      case "agent.response": {
        const data = event.data as { agentId: string; content: string };
        console.log(`[${data.agentId}] ${data.content}`);
        break;
      }
      case "agent.error": {
        const data = event.data as { agentId: string; error: string };
        console.error(`[ERROR:${data.agentId}] ${data.error}`);
        break;
      }
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    await engine.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => {});
}

async function secureCommand(): Promise<void> {
  const args = process.argv.slice(2);
  const shouldFix = args.includes("--fix");
  const config = await loadConfig();
  const dataDir = config.dataDir || ".myclaw";

  console.log(`\nMyClaw v${VERSION} — Security Audit (${IS_WINDOWS ? "Windows" : process.platform})\n`);

  // Auto-fix mode: lock down data directory
  if (shouldFix) {
    console.log("  Securing data directory...");
    const result = secureMyClaw(dataDir);
    console.log(`  ${result.success ? "[FIXED]" : "[ERROR]"} ${result.details}`);
    console.log("");
  }

  const report = await validateInstallation(dataDir);

  for (const check of report.checks) {
    const icon = check.passed ? "PASS" : (check.severity === "critical" ? "FAIL" : "WARN");
    console.log(`  [${icon}] ${check.name}`);
    console.log(`        ${check.details}`);
  }

  if (report.recommendations.length > 0) {
    console.log(`\nRecommended actions:`);
    for (const rec of report.recommendations) {
      console.log(`  - ${rec}`);
    }
    if (!shouldFix) {
      console.log(`\n  Tip: Run "myclaw secure --fix" to auto-fix folder permissions`);
    }
  }

  console.log(`\nSecurity config:`);
  console.log(`  Platform: ${IS_WINDOWS ? "Windows" : process.platform}`);
  console.log(`  Sandbox mode: ${config.security.sandbox}`);
  console.log(`  Network access: ${config.security.networkAccess}`);
  console.log(`  Max execution time: ${config.security.maxExecutionTime}ms`);
  console.log(`  Max memory: ${config.security.maxMemoryMB}MB`);
  console.log(`  Audit logging: ${config.security.auditLog ? "enabled" : "disabled"}`);
  console.log(`  RBAC: ${config.security.rbac?.enabled ? "enabled" : "disabled"}`);
  console.log(`  Rate limiting: ${config.security.rateLimiting?.enabled ? "enabled" : "disabled"}`);

  console.log(`\nOverall: ${report.secure ? "SECURE" : "ISSUES FOUND — review recommendations above"}\n`);
}

async function registerDefaultPlugins(
  engine: MyClawEngine,
  config: import("./core/types.js").MyClawConfig
): Promise<void> {
  // Model providers
  await engine.registerPlugin(new AnthropicPlugin());
  await engine.registerPlugin(new OpenAIPlugin());
  if (process.env["OPENROUTER_API_KEY"]) {
    await engine.registerPlugin(new OpenRouterPlugin());
  }

  // Tools
  await engine.registerPlugin(new ShellToolPlugin());
  await engine.registerPlugin(new WebToolPlugin());
  await engine.registerPlugin(new FilesystemToolPlugin());
  await engine.registerPlugin(new MemoryToolPlugin());
  await engine.registerPlugin(new CodeInterpreterPlugin());
  await engine.registerPlugin(new WorkflowToolPlugin());
  await engine.registerPlugin(new VoiceToolPlugin());
  await engine.registerPlugin(new InsightsToolPlugin());

  // Channels — only register if credentials are configured
  if (process.env["TELEGRAM_BOT_TOKEN"]) {
    await engine.registerPlugin(new TelegramPlugin());
  }
  if (process.env["DISCORD_BOT_TOKEN"]) {
    await engine.registerPlugin(new DiscordPlugin());
  }
  if (process.env["SLACK_BOT_TOKEN"]) {
    await engine.registerPlugin(new SlackPlugin());
  }
  if (process.env["WHATSAPP_TOKEN"]) {
    await engine.registerPlugin(new WhatsAppPlugin());
  }

  // Browser tools — only if Chrome is available
  if (process.env["CDP_PORT"]) {
    await engine.registerPlugin(new BrowserToolPlugin());
  }

  // Webhook API server
  if (config.webhook?.enabled) {
    const webhookServer = new WebhookServer(
      {
        port: config.webhook.port || 3200,
        apiToken: config.webhook.apiToken || process.env["MYCLAW_API_TOKEN"] || "",
        corsOrigin: config.webhook.corsOrigin,
      },
      { debug: () => {}, info: console.info, warn: console.warn, error: console.error }
    );
    await webhookServer.start();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
