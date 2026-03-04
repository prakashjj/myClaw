/**
 * Anthropic Model Plugin
 *
 * First-class Claude support. Unlike OpenClaw which was built around a
 * single provider, MyClaw treats all providers equally through the plugin
 * interface — but we make Anthropic the best experience.
 */

import type {
  ModelPlugin,
  ModelInfo,
  ChatRequest,
  ChatResponse,
  ChatChunk,
  Message,
  ToolDefinition,
  PluginContext,
} from "../../core/types.js";

export class AnthropicPlugin implements ModelPlugin {
  name = "anthropic";
  version = "1.0.0";
  type = "model" as const;
  provider = "anthropic";
  description = "Anthropic Claude models";

  private apiKey = "";
  private baseUrl = "https://api.anthropic.com";

  models: ModelInfo[] = [
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude Sonnet 4",
      contextWindow: 200_000,
      inputCostPerM: 3,
      outputCostPerM: 15,
      capabilities: ["chat", "vision", "tools", "code", "reasoning"],
    },
    {
      id: "claude-haiku-4-5-20251001",
      name: "Claude Haiku 4.5",
      contextWindow: 200_000,
      inputCostPerM: 0.8,
      outputCostPerM: 4,
      capabilities: ["chat", "vision", "tools", "code"],
    },
    {
      id: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      contextWindow: 200_000,
      inputCostPerM: 15,
      outputCostPerM: 75,
      capabilities: ["chat", "vision", "tools", "code", "reasoning"],
    },
  ];

  async init(ctx: PluginContext): Promise<void> {
    this.apiKey = process.env["ANTHROPIC_API_KEY"] || "";
    if (!this.apiKey) {
      ctx.log.warn("ANTHROPIC_API_KEY not set — Anthropic plugin will not work");
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const modelId = this.resolveModel(request.model);
    const body = this.buildRequestBody(modelId, request);

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${err}`);
    }

    const data = await res.json() as AnthropicResponse;
    return this.parseResponse(data);
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const modelId = this.resolveModel(request.model);
    const body = { ...this.buildRequestBody(modelId, request), stream: true };

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Anthropic API error: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const json = line.slice(6);
          if (json === "[DONE]") {
            yield { done: true };
            return;
          }
          try {
            const event = JSON.parse(json);
            if (event.type === "content_block_delta" && event.delta?.text) {
              yield { content: event.delta.text, done: false };
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    }
    yield { done: true };
  }

  private resolveModel(model: string): string {
    // Support both "anthropic/claude-sonnet-4-20250514" and "claude-sonnet-4-20250514" formats
    const id = model.includes("/") ? model.split("/")[1] : model;
    return id || model;
  }

  private buildRequestBody(model: string, request: ChatRequest) {
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "tool" ? ("user" as const) : m.role,
        content: m.role === "tool"
          ? `[Tool Result]: ${m.content}`
          : m.content,
      }));

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: request.maxTokens || 4096,
    };

    if (request.systemPrompt) {
      body["system"] = request.systemPrompt;
    }

    if (request.temperature !== undefined) {
      body["temperature"] = request.temperature;
    }

    if (request.tools && request.tools.length > 0) {
      body["tools"] = request.tools.map(this.toAnthropicTool);
    }

    return body;
  }

  private toAnthropicTool(tool: ToolDefinition) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [name, param] of Object.entries(tool.parameters)) {
      properties[name] = {
        type: param.type,
        description: param.description,
      };
      if (param.required) required.push(name);
    }

    return {
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object",
        properties,
        required,
      },
    };
  }

  private parseResponse(data: AnthropicResponse): ChatResponse {
    let content = "";
    const toolCalls: ChatResponse["toolCalls"] = [];

    for (const block of data.content) {
      if (block.type === "text") {
        content += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          args: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage
        ? {
            inputTokens: data.usage.input_tokens,
            outputTokens: data.usage.output_tokens,
            totalTokens: data.usage.input_tokens + data.usage.output_tokens,
          }
        : undefined,
      finishReason: data.stop_reason === "tool_use" ? "tool_use" : "stop",
    };
  }
}

// Anthropic API types (minimal)
interface AnthropicResponse {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
}
