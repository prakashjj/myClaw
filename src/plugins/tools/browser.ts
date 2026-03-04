/**
 * Browser Automation Tool Plugin
 *
 * UNIQUE FEATURE: Full browser automation via CDP (Chrome DevTools Protocol).
 * No external dependencies like Playwright or Puppeteer needed.
 * Connects directly to Chrome/Chromium over CDP.
 *
 * This is something PicoClaw and ZeroClaw can't do at all,
 * and OpenClaw requires a separate heavy dependency for.
 */

import type {
  ToolPlugin,
  ToolDefinition,
  ToolResult,
  PluginContext,
} from "../../core/types.js";

export class BrowserToolPlugin implements ToolPlugin {
  name = "browser";
  version = "1.0.0";
  type = "tool" as const;
  description = "Browser automation via Chrome DevTools Protocol";

  private ws: WebSocket | null = null;
  private msgId = 0;
  private pendingCommands = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }>();
  private log!: PluginContext["log"];

  tools: ToolDefinition[] = [
    {
      name: "browser_navigate",
      description: "Navigate the browser to a URL",
      parameters: {
        url: { type: "string", description: "URL to navigate to", required: true },
      },
    },
    {
      name: "browser_screenshot",
      description: "Take a screenshot of the current page",
      parameters: {},
    },
    {
      name: "browser_click",
      description: "Click on an element matching a CSS selector",
      parameters: {
        selector: { type: "string", description: "CSS selector of element to click", required: true },
      },
    },
    {
      name: "browser_type",
      description: "Type text into a focused input element",
      parameters: {
        selector: { type: "string", description: "CSS selector of input element", required: true },
        text: { type: "string", description: "Text to type", required: true },
      },
    },
    {
      name: "browser_get_text",
      description: "Get the text content of the current page or a specific element",
      parameters: {
        selector: { type: "string", description: "CSS selector (optional, defaults to body)", required: false },
      },
    },
    {
      name: "browser_evaluate",
      description: "Execute JavaScript in the browser and return the result",
      parameters: {
        expression: { type: "string", description: "JavaScript expression to evaluate", required: true },
      },
    },
  ];

  async init(ctx: PluginContext): Promise<void> {
    this.log = ctx.log;
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      await this.ensureConnected();

      switch (toolName) {
        case "browser_navigate":
          return this.navigate(args["url"] as string);
        case "browser_screenshot":
          return this.screenshot();
        case "browser_click":
          return this.click(args["selector"] as string);
        case "browser_type":
          return this.type(args["selector"] as string, args["text"] as string);
        case "browser_get_text":
          return this.getText(args["selector"] as string | undefined);
        case "browser_evaluate":
          return this.evaluate(args["expression"] as string);
        default:
          return { success: false, output: "", error: `Unknown tool: ${toolName}` };
      }
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws) return;

    // Discover Chrome CDP endpoint
    const cdpPort = process.env["CDP_PORT"] || "9222";
    const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
    const data = (await res.json()) as { webSocketDebuggerUrl: string };

    this.ws = new WebSocket(data.webSocketDebuggerUrl);

    await new Promise<void>((resolve, reject) => {
      this.ws!.onopen = () => resolve();
      this.ws!.onerror = (err) => reject(new Error(`CDP connection failed: ${err}`));
    });

    this.ws.onmessage = (event: MessageEvent) => {
      const msg = JSON.parse(String(event.data));
      const pending = this.pendingCommands.get(msg.id);
      if (pending) {
        this.pendingCommands.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
    };

    // Enable required domains
    await this.sendCDP("Page.enable", {});
    await this.sendCDP("Runtime.enable", {});
    await this.sendCDP("DOM.enable", {});
  }

  private sendCDP(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pendingCommands.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ id, method, params }));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingCommands.has(id)) {
          this.pendingCommands.delete(id);
          reject(new Error(`CDP command timed out: ${method}`));
        }
      }, 30_000);
    });
  }

  private async navigate(url: string): Promise<ToolResult> {
    await this.sendCDP("Page.navigate", { url });
    // Wait for load
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return { success: true, output: `Navigated to ${url}` };
  }

  private async screenshot(): Promise<ToolResult> {
    const result = (await this.sendCDP("Page.captureScreenshot", {
      format: "png",
    })) as { data: string };
    return {
      success: true,
      output: `Screenshot captured (${result.data.length} bytes base64)`,
      data: result.data,
    };
  }

  private async click(selector: string): Promise<ToolResult> {
    const result = await this.evaluate(
      `document.querySelector('${selector.replace(/'/g, "\\'")}')?.click(); 'clicked'`
    );
    return result;
  }

  private async type(selector: string, text: string): Promise<ToolResult> {
    // Focus the element
    await this.evaluate(
      `document.querySelector('${selector.replace(/'/g, "\\'")}')?.focus()`
    );

    // Type each character
    for (const char of text) {
      await this.sendCDP("Input.dispatchKeyEvent", {
        type: "keyDown",
        text: char,
      });
      await this.sendCDP("Input.dispatchKeyEvent", {
        type: "keyUp",
        text: char,
      });
    }

    return { success: true, output: `Typed "${text}" into ${selector}` };
  }

  private async getText(selector?: string): Promise<ToolResult> {
    const sel = selector || "body";
    const result = (await this.sendCDP("Runtime.evaluate", {
      expression: `document.querySelector('${sel.replace(/'/g, "\\'")}')?.innerText || ''`,
      returnByValue: true,
    })) as { result: { value: string } };

    const text = result.result.value;
    const truncated = text.length > 5000 ? text.slice(0, 5000) + "\n[...truncated]" : text;
    return { success: true, output: truncated };
  }

  private async evaluate(expression: string): Promise<ToolResult> {
    const result = (await this.sendCDP("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as { result: { value: unknown }; exceptionDetails?: { text: string } };

    if (result.exceptionDetails) {
      return { success: false, output: "", error: result.exceptionDetails.text };
    }

    return { success: true, output: String(result.result.value ?? "undefined") };
  }

  async destroy(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
