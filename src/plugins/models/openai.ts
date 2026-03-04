/**
 * OpenAI-Compatible Model Plugin
 *
 * Supports OpenAI, Azure OpenAI, and any OpenAI-compatible API
 * (Ollama, vLLM, LM Studio, Together, Groq, etc.)
 *
 * This single plugin covers dozens of providers — a key advantage
 * over OpenClaw which hardcodes provider-specific logic.
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

export class OpenAIPlugin implements ModelPlugin {
  name = "openai";
  version = "1.0.0";
  type = "model" as const;
  provider = "openai";
  description = "OpenAI and OpenAI-compatible APIs";

  private apiKey = "";
  private baseUrl = "https://api.openai.com/v1";

  models: ModelInfo[] = [
    {
      id: "gpt-4o",
      name: "GPT-4o",
      contextWindow: 128_000,
      inputCostPerM: 2.5,
      outputCostPerM: 10,
      capabilities: ["chat", "vision", "tools", "code"],
    },
    {
      id: "gpt-4o-mini",
      name: "GPT-4o Mini",
      contextWindow: 128_000,
      inputCostPerM: 0.15,
      outputCostPerM: 0.6,
      capabilities: ["chat", "vision", "tools", "code"],
    },
    {
      id: "o3-mini",
      name: "o3-mini",
      contextWindow: 200_000,
      inputCostPerM: 1.1,
      outputCostPerM: 4.4,
      capabilities: ["chat", "tools", "code", "reasoning"],
    },
  ];

  async init(ctx: PluginContext): Promise<void> {
    this.apiKey = process.env["OPENAI_API_KEY"] || "";
    this.baseUrl = process.env["OPENAI_BASE_URL"] || this.baseUrl;

    if (!this.apiKey) {
      ctx.log.warn("OPENAI_API_KEY not set — OpenAI plugin will not work");
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const modelId = this.resolveModel(request.model);
    const body = this.buildRequestBody(modelId, request);

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${err}`);
    }

    const data = (await res.json()) as OpenAIResponse;
    return this.parseResponse(data);
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const modelId = this.resolveModel(request.model);
    const body = { ...this.buildRequestBody(modelId, request), stream: true };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error: ${res.status}`);
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

  private resolveModel(model: string): string {
    const id = model.includes("/") ? model.split("/")[1] : model;
    return id || model;
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

  private parseResponse(data: OpenAIResponse): ChatResponse {
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

// OpenAI API types (minimal)
interface OpenAIResponse {
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
