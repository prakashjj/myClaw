/**
 * Shell Tool Plugin
 *
 * Executes shell commands with sandboxing support.
 * Unlike OpenClaw which gives unrestricted system access,
 * MyClaw enforces path restrictions and execution limits.
 */

import { exec } from "node:child_process";
import { resolve } from "node:path";
import type {
  ToolPlugin,
  ToolDefinition,
  ToolResult,
  PluginContext,
} from "../../core/types.js";

export class ShellToolPlugin implements ToolPlugin {
  name = "shell";
  version = "1.0.0";
  type = "tool" as const;
  description = "Execute shell commands securely";

  private allowedPaths: string[] = [];
  private maxExecutionTime = 30_000;
  private log!: PluginContext["log"];

  tools: ToolDefinition[] = [
    {
      name: "run_command",
      description: "Execute a shell command and return its output",
      parameters: {
        command: {
          type: "string",
          description: "The shell command to execute",
          required: true,
        },
        cwd: {
          type: "string",
          description: "Working directory for the command",
          required: false,
        },
      },
      sandboxed: true,
    },
  ];

  async init(ctx: PluginContext): Promise<void> {
    this.allowedPaths = ctx.config.security.allowedPaths || [];
    this.maxExecutionTime = ctx.config.security.maxExecutionTime;
    this.log = ctx.log;
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (toolName !== "run_command") {
      return { success: false, output: "", error: `Unknown tool: ${toolName}` };
    }

    const command = args["command"] as string;
    const cwd = (args["cwd"] as string) || process.cwd();

    // Validate working directory
    if (this.allowedPaths.length > 0) {
      const resolvedCwd = resolve(cwd);
      const allowed = this.allowedPaths.some((p) => resolvedCwd.startsWith(resolve(p)));
      if (!allowed) {
        return {
          success: false,
          output: "",
          error: `Working directory "${cwd}" is outside allowed paths`,
        };
      }
    }

    // Block dangerous commands
    const blocked = ["rm -rf /", "mkfs", "dd if=", ":(){:|:&};:"];
    if (blocked.some((b) => command.includes(b))) {
      return { success: false, output: "", error: "Command blocked for safety" };
    }

    this.log.debug(`Executing: ${command}`);

    return new Promise((resolvePromise) => {
      exec(
        command,
        {
          cwd,
          timeout: this.maxExecutionTime,
          maxBuffer: 1024 * 1024, // 1MB
          env: { ...process.env, NODE_ENV: "sandbox" },
        },
        (error, stdout, stderr) => {
          if (error) {
            resolvePromise({
              success: false,
              output: stdout,
              error: stderr || error.message,
            });
          } else {
            resolvePromise({
              success: true,
              output: stdout + (stderr ? `\n[stderr]: ${stderr}` : ""),
            });
          }
        }
      );
    });
  }
}
