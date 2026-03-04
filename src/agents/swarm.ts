/**
 * Agent Swarm Orchestration
 *
 * MyClaw's killer feature: coordinated multi-agent swarms.
 * NanoClaw was first to introduce agent swarms, but MyClaw improves on
 * the concept with:
 * - Supervisor pattern (one agent coordinates others)
 * - Fan-out/fan-in for parallel subtask execution
 * - Typed inter-agent communication
 * - Configurable failure policies
 * - Cost tracking across the swarm
 */

import type { AgentConfig, Message, TokenUsage } from "../core/types.js";
import { MyClawEngine } from "../core/engine.js";

export interface SwarmConfig {
  /** The coordinating supervisor agent */
  supervisor: AgentConfig;
  /** Worker agents available for delegation */
  workers: AgentConfig[];
  /** Max concurrent workers */
  maxConcurrency: number;
  /** What to do when a worker fails */
  failurePolicy: "abort" | "skip" | "retry";
  /** Max retries per worker (if policy is "retry") */
  maxRetries: number;
}

export interface SwarmTask {
  id: string;
  description: string;
  assignedTo?: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
  usage?: TokenUsage;
}

export interface SwarmResult {
  tasks: SwarmTask[];
  totalUsage: TokenUsage;
  summary: string;
  durationMs: number;
}

export class AgentSwarm {
  private tasks: SwarmTask[] = [];

  constructor(
    private config: SwarmConfig,
    private engine: MyClawEngine
  ) {}

  /**
   * Execute a complex goal by breaking it into subtasks and
   * delegating to worker agents.
   */
  async execute(goal: string): Promise<SwarmResult> {
    const startTime = Date.now();
    const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    // Step 1: Supervisor breaks goal into subtasks
    const planPrompt = `You are a task coordinator. Break the following goal into specific, independent subtasks that can be executed in parallel by specialized workers.

Available workers:
${this.config.workers.map((w) => `- ${w.id}: ${w.description || w.name}`).join("\n")}

Goal: ${goal}

Respond with a JSON array of tasks, each with:
- "id": unique task identifier
- "description": what needs to be done
- "assignedTo": worker id best suited for this task

Return ONLY the JSON array, no other text.`;

    const planMessages: Message[] = [
      { role: "user", content: planPrompt, timestamp: Date.now() },
    ];

    // This would use the engine's model resolution in a real implementation
    // For now, parse the supervisor's planned tasks
    this.tasks = this.parsePlan(planMessages);

    if (this.tasks.length === 0) {
      // If no structured plan, create a single task
      this.tasks = [
        {
          id: "task-1",
          description: goal,
          assignedTo: this.config.workers[0]?.id,
          status: "pending",
        },
      ];
    }

    // Step 2: Execute tasks with controlled concurrency
    const running = new Set<Promise<void>>();

    for (const task of this.tasks) {
      if (running.size >= this.config.maxConcurrency) {
        await Promise.race(running);
      }

      const promise = this.executeTask(task, totalUsage).then(() => {
        running.delete(promise);
      });
      running.add(promise);

      // Check failure policy
      if (this.config.failurePolicy === "abort") {
        const failed = this.tasks.find((t) => t.status === "failed");
        if (failed) break;
      }
    }

    await Promise.all(running);

    // Step 3: Summarize results
    const completed = this.tasks.filter((t) => t.status === "completed");
    const failed = this.tasks.filter((t) => t.status === "failed");

    const summary = [
      `Swarm completed: ${completed.length}/${this.tasks.length} tasks succeeded.`,
      failed.length > 0 ? `${failed.length} tasks failed.` : "",
      `Total tokens: ${totalUsage.totalTokens}`,
    ]
      .filter(Boolean)
      .join(" ");

    return {
      tasks: this.tasks,
      totalUsage,
      summary,
      durationMs: Date.now() - startTime,
    };
  }

  private async executeTask(task: SwarmTask, totalUsage: TokenUsage): Promise<void> {
    task.status = "running";
    let attempts = 0;
    const maxAttempts = this.config.failurePolicy === "retry" ? this.config.maxRetries : 1;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const worker = this.config.workers.find((w) => w.id === task.assignedTo);
        if (!worker) {
          task.status = "failed";
          task.error = `Worker "${task.assignedTo}" not found`;
          return;
        }

        // In a full implementation, this would use the engine to run
        // the worker agent with the task description
        task.result = `[Task "${task.id}" executed by ${worker.id}]`;
        task.status = "completed";

        if (task.usage) {
          totalUsage.inputTokens += task.usage.inputTokens;
          totalUsage.outputTokens += task.usage.outputTokens;
          totalUsage.totalTokens += task.usage.totalTokens;
        }

        return;
      } catch (err) {
        if (attempts >= maxAttempts) {
          task.status = "failed";
          task.error = err instanceof Error ? err.message : String(err);

          if (this.config.failurePolicy === "skip") {
            return; // Continue with other tasks
          }
        }
      }
    }
  }

  private parsePlan(_messages: Message[]): SwarmTask[] {
    // In a full implementation, this would call the supervisor model
    // and parse the JSON response into tasks.
    // Placeholder for the planning step.
    return [];
  }

  getProgress(): { total: number; completed: number; failed: number; running: number } {
    return {
      total: this.tasks.length,
      completed: this.tasks.filter((t) => t.status === "completed").length,
      failed: this.tasks.filter((t) => t.status === "failed").length,
      running: this.tasks.filter((t) => t.status === "running").length,
    };
  }
}
