/**
 * Filesystem Tool Plugin
 *
 * Secure file read/write/list operations.
 * All paths are validated against the security config's allowedPaths.
 */

import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import type {
  ToolPlugin,
  ToolDefinition,
  ToolResult,
  PluginContext,
} from "../../core/types.js";

export class FilesystemToolPlugin implements ToolPlugin {
  name = "filesystem";
  version = "1.0.0";
  type = "tool" as const;
  description = "Read, write, and list files securely";

  private allowedPaths: string[] = [];
  private log!: PluginContext["log"];

  tools: ToolDefinition[] = [
    {
      name: "read_file",
      description: "Read the contents of a file",
      parameters: {
        path: { type: "string", description: "Path to the file", required: true },
      },
    },
    {
      name: "write_file",
      description: "Write content to a file (creates parent directories if needed)",
      parameters: {
        path: { type: "string", description: "Path to the file", required: true },
        content: { type: "string", description: "Content to write", required: true },
      },
    },
    {
      name: "list_dir",
      description: "List files and directories at a path",
      parameters: {
        path: { type: "string", description: "Directory path", required: true },
      },
    },
  ];

  async init(ctx: PluginContext): Promise<void> {
    this.allowedPaths = ctx.config.security.allowedPaths || [];
    this.log = ctx.log;
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (toolName) {
      case "read_file":
        return this.readFile(args);
      case "write_file":
        return this.writeFile(args);
      case "list_dir":
        return this.listDir(args);
      default:
        return { success: false, output: "", error: `Unknown tool: ${toolName}` };
    }
  }

  private validatePath(path: string): string | null {
    const resolved = resolve(path);
    if (this.allowedPaths.length === 0) return resolved;
    const allowed = this.allowedPaths.some((p) => resolved.startsWith(resolve(p)));
    return allowed ? resolved : null;
  }

  private async readFile(args: Record<string, unknown>): Promise<ToolResult> {
    const path = this.validatePath(args["path"] as string);
    if (!path) {
      return { success: false, output: "", error: "Path outside allowed directories" };
    }

    try {
      const content = await readFile(path, "utf-8");
      return { success: true, output: content };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async writeFile(args: Record<string, unknown>): Promise<ToolResult> {
    const path = this.validatePath(args["path"] as string);
    if (!path) {
      return { success: false, output: "", error: "Path outside allowed directories" };
    }

    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, args["content"] as string, "utf-8");
      return { success: true, output: `Written to ${path}` };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async listDir(args: Record<string, unknown>): Promise<ToolResult> {
    const path = this.validatePath(args["path"] as string);
    if (!path) {
      return { success: false, output: "", error: "Path outside allowed directories" };
    }

    try {
      const entries = await readdir(path, { withFileTypes: true });
      const lines = await Promise.all(
        entries.map(async (e) => {
          const fullPath = resolve(path, e.name);
          if (e.isDirectory()) return `${e.name}/`;
          try {
            const s = await stat(fullPath);
            return `${e.name} (${formatSize(s.size)})`;
          } catch {
            return e.name;
          }
        })
      );
      return { success: true, output: lines.join("\n") };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
