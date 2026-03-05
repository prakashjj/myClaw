/**
 * MyClaw Sandbox - Process-Level Security
 *
 * Unlike NanoClaw which requires Docker/Apple Containers, MyClaw provides
 * security through lightweight process-level sandboxing that works everywhere.
 * No container runtime needed. No Docker. No Apple Container.
 *
 * Security model:
 * - Tool execution happens in forked child processes
 * - Filesystem access restricted to allowed paths
 * - Network access can be disabled
 * - Execution time and memory limits enforced
 * - No ambient access to parent process state
 */

import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { SecurityConfig, ToolResult } from "./types.js";
import { IS_WINDOWS, isPathAllowed, getSandboxTempDir } from "./platform.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class Sandbox {
  constructor(private config: SecurityConfig) {}

  async execute(
    code: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    if (this.config.sandbox === "none") {
      return this.executeUnsandboxed(code, args);
    }

    if (this.config.sandbox === "process") {
      return this.executeInProcess(code, args);
    }

    if (this.config.sandbox === "container") {
      return this.executeInContainer(code, args);
    }

    throw new Error(`Unknown sandbox mode: ${this.config.sandbox}`);
  }

  private async executeInProcess(
    code: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    return new Promise((resolvePromise) => {
      const workerPath = join(__dirname, "sandbox-worker.js");
      const child = fork(workerPath, [], {
        env: this.getSandboxedEnv(),
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        execArgv: [
          `--max-old-space-size=${this.config.maxMemoryMB}`,
        ],
      });

      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolvePromise({
          success: false,
          output: "",
          error: `Execution timed out after ${this.config.maxExecutionTime}ms`,
        });
      }, this.config.maxExecutionTime);

      child.on("message", (result: ToolResult) => {
        clearTimeout(timeout);
        resolvePromise(result);
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        resolvePromise({
          success: false,
          output: "",
          error: `Sandbox error: ${err.message}`,
        });
      });

      child.on("exit", (exitCode) => {
        clearTimeout(timeout);
        if (exitCode !== 0) {
          resolvePromise({
            success: false,
            output: "",
            error: `Process exited with code ${exitCode}`,
          });
        }
      });

      child.send({ code, args, allowedPaths: this.config.allowedPaths });
    });
  }

  private async executeInContainer(
    code: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    // Container-based execution for maximum isolation
    // Supports Docker, Podman, and Apple Containers
    const { execSync } = await import("node:child_process");

    const mounts = (this.config.allowedPaths || [])
      .map((p) => `-v ${resolve(p)}:${resolve(p)}:ro`)
      .join(" ");

    const networkFlag = this.config.networkAccess ? "" : "--network=none";
    const memoryFlag = `--memory=${this.config.maxMemoryMB}m`;
    const payload = JSON.stringify({ code, args });

    try {
      const result = execSync(
        `echo '${payload.replace(/'/g, "\\'")}' | docker run -i --rm ${networkFlag} ${memoryFlag} ${mounts} node:22-slim node -e "
          let data = '';
          process.stdin.on('data', c => data += c);
          process.stdin.on('end', () => {
            const {code, args} = JSON.parse(data);
            const fn = new Function('args', code);
            const result = fn(args);
            process.stdout.write(JSON.stringify({success: true, output: String(result)}));
          });
        "`,
        { timeout: this.config.maxExecutionTime, encoding: "utf-8" }
      );
      return JSON.parse(result);
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async executeUnsandboxed(
    code: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    try {
      const fn = new Function("args", code);
      const result = await fn(args);
      return { success: true, output: String(result) };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private getSandboxedEnv(): Record<string, string> {
    const tempDir = getSandboxTempDir();
    const env: Record<string, string> = {
      NODE_ENV: "sandbox",
    };

    if (IS_WINDOWS) {
      env["USERPROFILE"] = tempDir;
      env["TEMP"] = tempDir;
      env["TMP"] = tempDir;
      // Pass SystemRoot so Node.js can find system DLLs
      if (process.env["SystemRoot"]) env["SystemRoot"] = process.env["SystemRoot"];
      if (process.env["COMSPEC"]) env["COMSPEC"] = process.env["COMSPEC"];
    } else {
      env["HOME"] = tempDir;
    }

    // Only pass through specific safe env vars
    if (this.config.networkAccess) {
      if (process.env["HTTP_PROXY"]) env["HTTP_PROXY"] = process.env["HTTP_PROXY"];
      if (process.env["HTTPS_PROXY"]) env["HTTPS_PROXY"] = process.env["HTTPS_PROXY"];
    }

    return env;
  }

  /**
   * Validate that a path is within allowed paths.
   * Cross-platform: handles Windows backslashes and case-insensitive drives.
   */
  validatePath(path: string): boolean {
    if (!this.config.allowedPaths || this.config.allowedPaths.length === 0) {
      return true;
    }
    return isPathAllowed(path, this.config.allowedPaths);
  }
}
