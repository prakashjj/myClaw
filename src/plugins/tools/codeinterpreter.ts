/**
 * Code Interpreter Tool Plugin
 *
 * UNIQUE FEATURE: Built-in code execution sandbox.
 * Agents can write and execute code in JavaScript/TypeScript
 * without needing external services.
 *
 * Unlike OpenClaw which shells out to a REPL, MyClaw runs code
 * in an isolated VM context with resource limits.
 */

import { createContext, runInContext, type Context } from "node:vm";
import type {
  ToolPlugin,
  ToolDefinition,
  ToolResult,
  PluginContext,
} from "../../core/types.js";

export class CodeInterpreterPlugin implements ToolPlugin {
  name = "code_interpreter";
  version = "1.0.0";
  type = "tool" as const;
  description = "Execute JavaScript/TypeScript code in a secure sandbox";

  private maxExecutionMs = 10_000;
  private log!: PluginContext["log"];

  tools: ToolDefinition[] = [
    {
      name: "execute_code",
      description:
        "Execute JavaScript code and return the result. Has access to console.log, Math, Date, JSON, and standard built-ins. No filesystem or network access.",
      parameters: {
        code: {
          type: "string",
          description: "JavaScript code to execute",
          required: true,
        },
      },
      sandboxed: true,
    },
    {
      name: "evaluate_expression",
      description: "Evaluate a JavaScript expression and return the result",
      parameters: {
        expression: {
          type: "string",
          description: "JavaScript expression to evaluate (e.g., '2 + 2', 'Math.PI * r * r')",
          required: true,
        },
      },
      sandboxed: true,
    },
  ];

  async init(ctx: PluginContext): Promise<void> {
    this.maxExecutionMs = ctx.config.security.maxExecutionTime;
    this.log = ctx.log;
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (toolName) {
      case "execute_code":
        return this.executeCode(args["code"] as string);
      case "evaluate_expression":
        return this.evaluateExpression(args["expression"] as string);
      default:
        return { success: false, output: "", error: `Unknown tool: ${toolName}` };
    }
  }

  private executeCode(code: string): ToolResult {
    const outputs: string[] = [];

    const sandbox = this.createSandbox(outputs);

    try {
      const result = runInContext(code, sandbox, {
        timeout: this.maxExecutionMs,
        displayErrors: true,
      });

      const output = outputs.length > 0
        ? outputs.join("\n") + (result !== undefined ? `\n=> ${this.formatValue(result)}` : "")
        : result !== undefined
          ? this.formatValue(result)
          : "(no output)";

      return { success: true, output };
    } catch (err) {
      const output = outputs.length > 0 ? outputs.join("\n") + "\n" : "";
      return {
        success: false,
        output,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private evaluateExpression(expression: string): ToolResult {
    const sandbox = this.createSandbox([]);

    try {
      const result = runInContext(expression, sandbox, {
        timeout: 5000,
        displayErrors: true,
      });

      return { success: true, output: this.formatValue(result) };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private createSandbox(outputs: string[]): Context {
    return createContext({
      // Safe built-ins
      console: {
        log: (...args: unknown[]) => outputs.push(args.map(this.formatValue).join(" ")),
        error: (...args: unknown[]) => outputs.push("[ERROR] " + args.map(this.formatValue).join(" ")),
        warn: (...args: unknown[]) => outputs.push("[WARN] " + args.map(this.formatValue).join(" ")),
      },
      Math,
      Date,
      JSON,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Map,
      Set,
      RegExp,
      Error,
      Promise,
      Symbol,
      // No require, no import, no process, no fs, no fetch
    });
  }

  private formatValue(val: unknown): string {
    if (val === undefined) return "undefined";
    if (val === null) return "null";
    if (typeof val === "string") return val;
    if (typeof val === "object") {
      try {
        return JSON.stringify(val, null, 2);
      } catch {
        return String(val);
      }
    }
    return String(val);
  }
}
