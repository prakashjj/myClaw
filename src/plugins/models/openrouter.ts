/**
 * OpenRouter Model Plugin
 *
 * First-class OpenRouter support — not just "set OPENAI_BASE_URL".
 *
 * OpenRouter advantages over direct API calls:
 * - Access 300+ models from a single API key
 * - Automatic fallback if a provider is down
 * - Provider routing preferences (cheapest, fastest, specific provider)
 * - Unified billing across all providers
 * - Usage tracking and cost monitoring
 *
 * Environment variables:
 *   OPENROUTER_API_KEY   - Your OpenRouter API key
 *   OPENROUTER_APP_NAME  - Your app name (shown in OpenRouter dashboard)
 *   OPENROUTER_SITE_URL  - Your site URL (for rankings/attribution)
 */

import type {
  ModelPlugin,
  ModelInfo,
  ChatRequest,
  ChatResponse,
  ChatChunk,
  ToolDefinition,
  PluginContext,
} from "../../core/types.js";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export class OpenRouterPlugin implements ModelPlugin {
  name = "openrouter";
  version = "1.0.0";
  type = "model" as const;
  provider = "openrouter";
  description = "OpenRouter — 300+ models, single API key";

  private apiKey = "";
  private appName = "MyClaw";
  private siteUrl = "";
  private log!: PluginContext["log"];

  /**
   * Popular models available through OpenRouter.
   * OpenRouter supports 300+ models — these are the most commonly used.
   * Use any model ID from https://openrouter.ai/models with the
   * "openrouter/" prefix in your config.
   */
  models: ModelInfo[] = [
    // Anthropic
    {
      id: "anthropic/claude-sonnet-4",
      name: "Claude Sonnet 4",
      contextWindow: 200_000,
      inputCostPerM: 3,
      outputCostPerM: 15,
      capabilities: ["chat", "vision", "tools", "code", "reasoning"],
    },
    {
      id: "anthropic/claude-haiku-4.5",
      name: "Claude Haiku 4.5",
      contextWindow: 200_000,
      inputCostPerM: 0.8,
      outputCostPerM: 4,
      capabilities: ["chat", "vision", "tools", "code"],
    },
    {
      id: "anthropic/claude-opus-4-20250514",
      name: "Claude Opus 4",
      contextWindow: 200_000,
      inputCostPerM: 15,
      outputCostPerM: 75,
      capabilities: ["chat", "vision", "tools", "code", "reasoning"],
    },
    // OpenAI
    {
      id: "openai/gpt-4o",
      name: "GPT-4o",
      contextWindow: 128_000,
      inputCostPerM: 2.5,
      outputCostPerM: 10,
      capabilities: ["chat", "vision", "tools", "code"],
    },
    {
      id: "openai/o3-mini",
      name: "o3-mini",
      contextWindow: 200_000,
      inputCostPerM: 1.1,
      outputCostPerM: 4.4,
      capabilities: ["chat", "tools", "code", "reasoning"],
    },
    // Google
    {
      id: "google/gemini-2.5-pro-preview",
      name: "Gemini 2.5 Pro",
      contextWindow: 1_000_000,
      inputCostPerM: 1.25,
      outputCostPerM: 10,
      capabilities: ["chat", "vision", "tools", "code", "reasoning"],
    },
    {
      id: "google/gemini-2.0-flash-001",
      name: "Gemini 2.0 Flash",
      contextWindow: 1_000_000,
      inputCostPerM: 0.1,
      outputCostPerM: 0.4,
      capabilities: ["chat", "vision", "tools", "code"],
    },
    // Meta
    {
      id: "meta-llama/llama-4-maverick",
      name: "Llama 4 Maverick",
      contextWindow: 1_000_000,
      inputCostPerM: 0.2,
      outputCostPerM: 0.6,
      capabilities: ["chat", "tools", "code"],
    },
    // DeepSeek
    {
      id: "deepseek/deepseek-r1",
      name: "DeepSeek R1",
      contextWindow: 64_000,
      inputCostPerM: 0.55,
      outputCostPerM: 2.19,
      capabilities: ["chat", "code", "reasoning"],
    },
    // Mistral
    {
      id: "mistralai/mistral-large-2411",
      name: "Mistral Large",
      contextWindow: 128_000,
      inputCostPerM: 2,
      outputCostPerM: 6,
      capabilities: ["chat", "tools", "code"],
    },
  ];

  async init(ctx: PluginContext): Promise<void> {
    this.apiKey = process.env["OPENROUTER_API_KEY"] || "";
    this.appName = process.env["OPENROUTER_APP_NAME"] || "MyClaw";
    this.siteUrl = process.env["OPENROUTER_SITE_URL"] || "";
    this.log = ctx.log;

    if (!this.apiKey) {
      ctx.log.warn("OPENROUTER_API_KEY not set — OpenRouter plugin will not work");
    } else {
      ctx.log.info("OpenRouter plugin loaded (300+ models available)");
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const modelId = this.resolveModel(request.model);
    const body = this.buildRequestBody(modelId, request);

    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenRouter API error (${res.status}): ${err}`);
    }

    const data = (await res.json()) as OpenRouterResponse;
    return this.parseResponse(data);
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const modelId = this.resolveModel(request.model);
    const body = { ...this.buildRequestBody(modelId, request), stream: true };

    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`OpenRouter API error: ${res.status}`);
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
          const json = line.slice(6).trim();
          if (json === "[DONE]") {
            yield { done: true };
            return;
          }
          try {
            const chunk = JSON.parse(json);
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) {
              yield { content: delta.content, done: false };
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    }
    yield { done: true };
  }

  /**
   * Fetch available models from OpenRouter API.
   * Useful for discovering new models.
   */
  async listAvailableModels(): Promise<Array<{ id: string; name: string; pricing: { prompt: string; completion: string } }>> {
    const res = await fetch(`${OPENROUTER_BASE}/models`, {
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to list models: ${res.status}`);
    }

    const data = (await res.json()) as { data: Array<{ id: string; name: string; pricing: { prompt: string; completion: string } }> };
    return data.data;
  }

  /**
   * Check remaining credits on your OpenRouter account.
   */
  async getCredits(): Promise<{ remaining: number; limit: number }> {
    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to check credits: ${res.status}`);
    }

    const data = (await res.json()) as { data: { usage: number; limit: number | null } };
    return {
      remaining: (data.data.limit || Infinity) - data.data.usage,
      limit: data.data.limit || Infinity,
    };
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "X-Title": this.appName,
    };

    if (this.siteUrl) {
      headers["HTTP-Referer"] = this.siteUrl;
    }

    return headers;
  }

  private resolveModel(model: string): string {
    // If already a full model ID (e.g. "anthropic/claude-sonnet-4-20250514"), use as-is
    if (model.includes("/") && !model.startsWith("openrouter/")) {
      return model;
    }
    // Strip "openrouter/" prefix if present
    if (model.startsWith("openrouter/")) {
      return model.slice("openrouter/".length);
    }
    return model;
  }

  private buildRequestBody(model: string, request: ChatRequest) {
    const messages: Array<{ role: string; content: string }> = [];

    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }

    for (const m of request.messages) {
      messages.push({
        role: m.role === "tool" ? "user" : m.role,
        content: m.role === "tool" ? `[Tool Result]: ${m.content}` : m.content,
      });
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: request.maxTokens || 4096,
    };

    if (request.temperature !== undefined) {
      body["temperature"] = request.temperature;
    }

    if (request.tools && request.tools.length > 0) {
      body["tools"] = request.tools.map(this.toOpenAITool);
    }

    return body;
  }

  private toOpenAITool(tool: ToolDefinition) {
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
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties,
          required,
        },
      },
    };
  }

  private parseResponse(data: OpenRouterResponse): ChatResponse {
    const choice = data.choices[0];
    const toolCalls = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content: choice.message.content || "",
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
      finishReason:
        choice.finish_reason === "tool_calls" ? "tool_use" : "stop",
    };
  }
}

// OpenRouter API types
interface OpenRouterResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
