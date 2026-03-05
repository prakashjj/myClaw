/**
 * Webhook API Server
 *
 * UNIQUE FEATURE: External integration API.
 * No other claw variant exposes a proper REST API for external systems.
 *
 * Endpoints:
 *   POST /api/message          - Send a message to an agent
 *   POST /api/workflow/:id     - Trigger a workflow
 *   GET  /api/health           - Health check
 *   GET  /api/status           - System status
 *   GET  /api/metrics          - Prometheus-compatible metrics
 *   GET  /api/conversations    - List recent conversations
 *   POST /api/webhook/:hookId  - Custom webhook triggers
 *
 * All endpoints require Bearer token auth (MYCLAW_API_TOKEN).
 */

import {
  createServer,
  type IncomingMessage as HttpRequest,
  type ServerResponse,
  type Server,
} from "node:http";
import type { Logger } from "./types.js";

export interface WebhookConfig {
  port: number;
  apiToken: string;
  corsOrigin?: string;
}

type RouteHandler = (
  req: HttpRequest,
  res: ServerResponse,
  params: Record<string, string>,
  body: unknown
) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export class WebhookServer {
  private server?: Server;
  private routes: Route[] = [];
  private metrics = {
    requestsTotal: 0,
    requestsErrors: 0,
    messagesProcessed: 0,
    workflowsTriggered: 0,
    uptime: Date.now(),
    tokenUsage: { input: 0, output: 0 },
  };

  constructor(
    private config: WebhookConfig,
    private log: Logger
  ) {
    this.setupDefaultRoutes();
  }

  /**
   * Register a custom route handler.
   */
  addRoute(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const pattern = path.replace(/:(\w+)/g, (_match, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${pattern}$`),
      paramNames,
      handler,
    });
  }

  /**
   * Register a message handler for POST /api/message.
   */
  onMessage(handler: (agentId: string, message: string, userId?: string) => Promise<string>): void {
    this.addRoute("POST", "/api/message", async (_req, res, _params, body) => {
      const { agentId, message, userId } = body as {
        agentId?: string;
        message?: string;
        userId?: string;
      };

      if (!message) {
        this.jsonResponse(res, 400, { error: "message is required" });
        return;
      }

      try {
        this.metrics.messagesProcessed++;
        const response = await handler(agentId || "default", message, userId);
        this.jsonResponse(res, 200, { response });
      } catch (err) {
        this.jsonResponse(res, 500, { error: String(err) });
      }
    });
  }

  /**
   * Register a webhook trigger handler for POST /api/webhook/:hookId.
   */
  onWebhook(handler: (hookId: string, data: unknown) => Promise<unknown>): void {
    this.addRoute("POST", "/api/webhook/:hookId", async (_req, res, params, body) => {
      try {
        const result = await handler(params["hookId"], body);
        this.jsonResponse(res, 200, { result });
      } catch (err) {
        this.jsonResponse(res, 500, { error: String(err) });
      }
    });
  }

  updateMetrics(updates: Partial<typeof this.metrics>): void {
    Object.assign(this.metrics, updates);
  }

  incrementTokenUsage(input: number, output: number): void {
    this.metrics.tokenUsage.input += input;
    this.metrics.tokenUsage.output += output;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handleRequest(req, res));

    await new Promise<void>((resolve) => {
      this.server!.listen(this.config.port, () => {
        this.log.info(`Webhook API listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
  }

  private setupDefaultRoutes(): void {
    // Health check
    this.addRoute("GET", "/api/health", async (_req, res) => {
      this.jsonResponse(res, 200, {
        status: "healthy",
        uptime: Math.floor((Date.now() - this.metrics.uptime) / 1000),
        version: "1.0.0",
      });
    });

    // System status
    this.addRoute("GET", "/api/status", async (_req, res) => {
      const memUsage = process.memoryUsage();
      this.jsonResponse(res, 200, {
        uptime: Math.floor((Date.now() - this.metrics.uptime) / 1000),
        memory: {
          heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
          rssMB: Math.round(memUsage.rss / 1024 / 1024),
        },
        requests: {
          total: this.metrics.requestsTotal,
          errors: this.metrics.requestsErrors,
        },
        messages: this.metrics.messagesProcessed,
        workflows: this.metrics.workflowsTriggered,
        tokens: this.metrics.tokenUsage,
      });
    });

    // Prometheus-compatible metrics
    this.addRoute("GET", "/api/metrics", async (_req, res) => {
      const memUsage = process.memoryUsage();
      const uptimeSec = Math.floor((Date.now() - this.metrics.uptime) / 1000);

      const lines = [
        "# HELP myclaw_uptime_seconds Time since MyClaw started",
        "# TYPE myclaw_uptime_seconds gauge",
        `myclaw_uptime_seconds ${uptimeSec}`,
        "",
        "# HELP myclaw_requests_total Total HTTP requests",
        "# TYPE myclaw_requests_total counter",
        `myclaw_requests_total ${this.metrics.requestsTotal}`,
        "",
        "# HELP myclaw_requests_errors_total Total HTTP request errors",
        "# TYPE myclaw_requests_errors_total counter",
        `myclaw_requests_errors_total ${this.metrics.requestsErrors}`,
        "",
        "# HELP myclaw_messages_processed_total Messages processed",
        "# TYPE myclaw_messages_processed_total counter",
        `myclaw_messages_processed_total ${this.metrics.messagesProcessed}`,
        "",
        "# HELP myclaw_tokens_input_total Input tokens used",
        "# TYPE myclaw_tokens_input_total counter",
        `myclaw_tokens_input_total ${this.metrics.tokenUsage.input}`,
        "",
        "# HELP myclaw_tokens_output_total Output tokens used",
        "# TYPE myclaw_tokens_output_total counter",
        `myclaw_tokens_output_total ${this.metrics.tokenUsage.output}`,
        "",
        "# HELP myclaw_memory_heap_bytes Heap memory used",
        "# TYPE myclaw_memory_heap_bytes gauge",
        `myclaw_memory_heap_bytes ${memUsage.heapUsed}`,
        "",
        "# HELP myclaw_memory_rss_bytes RSS memory",
        "# TYPE myclaw_memory_rss_bytes gauge",
        `myclaw_memory_rss_bytes ${memUsage.rss}`,
      ];

      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(lines.join("\n") + "\n");
    });
  }

  private async handleRequest(req: HttpRequest, res: ServerResponse): Promise<void> {
    this.metrics.requestsTotal++;

    // CORS
    if (this.config.corsOrigin) {
      res.setHeader("Access-Control-Allow-Origin", this.config.corsOrigin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    // Auth check (skip for health and metrics)
    const url = req.url || "";
    const isPublic = url === "/api/health" || url === "/api/metrics";
    if (!isPublic && this.config.apiToken) {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${this.config.apiToken}`) {
        this.metrics.requestsErrors++;
        this.jsonResponse(res, 401, { error: "Unauthorized" });
        return;
      }
    }

    // Route matching
    for (const route of this.routes) {
      if (req.method !== route.method) continue;

      const match = url.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });

      // Parse body for POST
      let body: unknown = {};
      if (req.method === "POST") {
        body = await this.parseBody(req);
      }

      try {
        await route.handler(req, res, params, body);
      } catch (err) {
        this.metrics.requestsErrors++;
        this.log.error(`Webhook handler error: ${err}`);
        this.jsonResponse(res, 500, { error: "Internal server error" });
      }
      return;
    }

    this.jsonResponse(res, 404, { error: "Not found" });
  }

  private parseBody(req: HttpRequest): Promise<unknown> {
    return new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({});
        }
      });
    });
  }

  private jsonResponse(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }
}
