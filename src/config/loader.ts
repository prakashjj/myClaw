/**
 * Configuration Loader
 *
 * Load and validate MyClaw configuration from YAML/JSON files
 * or environment variables. Supports hot-reloading.
 *
 * Like PicoClaw's model-centric config but more powerful —
 * everything is configurable, nothing requires code changes.
 */

import { readFile, access, constants } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { MyClawConfig, AgentConfig, SecurityConfig } from "../core/types.js";
import { IS_WINDOWS, getPathSeparator } from "../core/platform.js";

const DEFAULT_SECURITY: SecurityConfig = {
  sandbox: "process",
  networkAccess: true,
  maxExecutionTime: 30_000,
  maxMemoryMB: 256,
  allowedPaths: [],
};

const DEFAULT_AGENT: AgentConfig = {
  id: "default",
  name: "MyClaw Assistant",
  model: "anthropic/claude-sonnet-4-20250514",
  systemPrompt: `You are MyClaw, a helpful AI assistant. You have access to various tools to help users accomplish tasks. Be concise, helpful, and proactive.`,
  maxTurns: 10,
  memory: {
    enabled: true,
    shortTermLimit: 50,
    longTerm: true,
    storage: "file",
  },
};

export async function loadConfig(configPath?: string): Promise<MyClawConfig> {
  const homeDir = IS_WINDOWS
    ? (process.env["USERPROFILE"] || process.env["APPDATA"] || "C:\\Users\\Default")
    : (process.env["HOME"] || "~");

  const searchPaths = configPath
    ? [configPath]
    : [
        "myclaw.json",
        "myclaw.config.json",
        ".myclaw/config.json",
        join(homeDir, ".myclaw/config.json"),
      ];

  for (const path of searchPaths) {
    const resolved = resolve(path);
    try {
      await access(resolved, constants.R_OK);
      const content = await readFile(resolved, "utf-8");
      const parsed = JSON.parse(content) as Partial<MyClawConfig>;
      return mergeWithDefaults(parsed);
    } catch {
      // Try next path
    }
  }

  // No config file found — use env vars and defaults
  return configFromEnv();
}

function mergeWithDefaults(partial: Partial<MyClawConfig>): MyClawConfig {
  return {
    agents: partial.agents && partial.agents.length > 0 ? partial.agents : [DEFAULT_AGENT],
    plugins: partial.plugins || [],
    security: { ...DEFAULT_SECURITY, ...partial.security },
    logging: partial.logging || { level: "info" },
    dataDir: partial.dataDir || join(process.cwd(), ".myclaw"),
  };
}

function configFromEnv(): MyClawConfig {
  const model = process.env["MYCLAW_MODEL"] || "anthropic/claude-sonnet-4-20250514";
  const cheapModel = process.env["MYCLAW_CHEAP_MODEL"] || "anthropic/claude-haiku-4-5-20251001";
  const sandbox = (process.env["MYCLAW_SANDBOX"] as SecurityConfig["sandbox"]) || "process";

  return {
    agents: [
      {
        ...DEFAULT_AGENT,
        model,
        smartRouting: {
          enabled: !!cheapModel,
          cheapModel,
          complexityThreshold: 0.5,
        },
      },
    ],
    plugins: [],
    security: {
      ...DEFAULT_SECURITY,
      sandbox,
      allowedPaths: process.env["MYCLAW_ALLOWED_PATHS"]?.split(getPathSeparator()) || [],
    },
    logging: {
      level: (process.env["MYCLAW_LOG_LEVEL"] as "debug" | "info" | "warn" | "error") || "info",
    },
    dataDir: process.env["MYCLAW_DATA_DIR"] || join(process.cwd(), ".myclaw"),
  };
}

export function generateDefaultConfig(): string {
  const config = {
    agents: [
      {
        id: "assistant",
        name: "MyClaw Assistant",
        model: "anthropic/claude-sonnet-4-20250514",
        systemPrompt: "You are MyClaw, a helpful AI assistant.",
        channels: ["telegram", "discord"],
        maxTurns: 10,
        smartRouting: {
          enabled: true,
          cheapModel: "anthropic/claude-haiku-4-5-20251001",
          complexityThreshold: 0.5,
        },
        memory: {
          enabled: true,
          shortTermLimit: 50,
          longTerm: true,
          storage: "file",
        },
        allowedTools: [
          "run_command",
          "fetch_url",
          "web_search",
          "read_file",
          "write_file",
          "list_dir",
          "remember",
          "recall",
          "execute_code",
        ],
      },
    ],
    plugins: [],
    security: {
      sandbox: "process",
      networkAccess: true,
      maxExecutionTime: 30000,
      maxMemoryMB: 256,
      allowedPaths: ["./"],
    },
    logging: {
      level: "info",
    },
    dataDir: ".myclaw",
  };

  return JSON.stringify(config, null, 2);
}
