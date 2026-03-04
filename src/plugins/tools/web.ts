/**
 * Web Tool Plugin
 *
 * Web search and URL fetching capabilities.
 * Provides agents with the ability to access the internet.
 */

import type {
  ToolPlugin,
  ToolDefinition,
  ToolResult,
  PluginContext,
} from "../../core/types.js";

export class WebToolPlugin implements ToolPlugin {
  name = "web";
  version = "1.0.0";
  type = "tool" as const;
  description = "Web search and URL fetching";

  private log!: PluginContext["log"];

  tools: ToolDefinition[] = [
    {
      name: "fetch_url",
      description: "Fetch the content of a URL and return it as text",
      parameters: {
        url: {
          type: "string",
          description: "The URL to fetch",
          required: true,
        },
        max_length: {
          type: "number",
          description: "Maximum characters to return (default: 10000)",
          required: false,
          default: 10000,
        },
      },
    },
    {
      name: "web_search",
      description: "Search the web and return results",
      parameters: {
        query: {
          type: "string",
          description: "The search query",
          required: true,
        },
        num_results: {
          type: "number",
          description: "Number of results to return (default: 5)",
          required: false,
          default: 5,
        },
      },
    },
  ];

  async init(ctx: PluginContext): Promise<void> {
    this.log = ctx.log;
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (toolName) {
      case "fetch_url":
        return this.fetchUrl(args);
      case "web_search":
        return this.webSearch(args);
      default:
        return { success: false, output: "", error: `Unknown tool: ${toolName}` };
    }
  }

  private async fetchUrl(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args["url"] as string;
    const maxLength = (args["max_length"] as number) || 10000;

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "MyClaw/1.0 (AI Agent)",
          Accept: "text/html, text/plain, application/json",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        return { success: false, output: "", error: `HTTP ${res.status}: ${res.statusText}` };
      }

      let text = await res.text();

      // Strip HTML tags for cleaner output
      text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
      text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
      text = text.replace(/<[^>]+>/g, " ");
      text = text.replace(/\s+/g, " ").trim();

      if (text.length > maxLength) {
        text = text.slice(0, maxLength) + "\n[...truncated]";
      }

      this.log.debug(`Fetched ${url}: ${text.length} chars`);
      return { success: true, output: text };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async webSearch(args: Record<string, unknown>): Promise<ToolResult> {
    const query = args["query"] as string;
    const numResults = (args["num_results"] as number) || 5;

    // Use DuckDuckGo HTML search (no API key needed)
    try {
      const encoded = encodeURIComponent(query);
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
        headers: {
          "User-Agent": "MyClaw/1.0 (AI Agent)",
        },
        signal: AbortSignal.timeout(10000),
      });

      const html = await res.text();

      // Extract result snippets
      const results: string[] = [];
      const regex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      let match;

      while ((match = regex.exec(html)) !== null && results.length < numResults) {
        const url = match[1].replace(/<[^>]+>/g, "").trim();
        const title = match[2].replace(/<[^>]+>/g, "").trim();
        const snippet = match[3].replace(/<[^>]+>/g, "").trim();
        results.push(`${title}\n${url}\n${snippet}`);
      }

      if (results.length === 0) {
        return { success: true, output: "No results found." };
      }

      return {
        success: true,
        output: results.join("\n\n---\n\n"),
      };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
