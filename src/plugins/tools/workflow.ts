/**
 * Workflow Automation Tool Plugin
 *
 * UNIQUE FEATURE: Visual-style workflow builder that agents can create
 * and execute. Think IFTTT/Zapier but controlled by AI agents.
 *
 * No other claw variant has this. OpenClaw has basic cron scheduling.
 * MyClaw has full multi-step workflow pipelines with:
 * - Conditional branching
 * - Parallel execution
 * - Data transformation between steps
 * - Error handling with retry/fallback
 * - Event triggers (time, message, webhook)
 */

import type {
  ToolPlugin,
  ToolDefinition,
  ToolResult,
  PluginContext,
} from "../../core/types.js";

export interface WorkflowStep {
  id: string;
  name: string;
  /** Tool to invoke */
  tool: string;
  /** Arguments for the tool (can reference previous step outputs via {{stepId.output}}) */
  args: Record<string, unknown>;
  /** Condition to check before executing (JS expression) */
  condition?: string;
  /** Steps to run in parallel at this point */
  parallel?: WorkflowStep[];
  /** What to do on failure */
  onError?: "stop" | "skip" | "retry";
  maxRetries?: number;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  createdAt: number;
}

export type WorkflowTrigger =
  | { type: "manual" }
  | { type: "cron"; schedule: string }
  | { type: "message"; pattern: string }
  | { type: "webhook"; path: string };

interface StepResult {
  stepId: string;
  success: boolean;
  output: string;
  data?: unknown;
  durationMs: number;
}

export class WorkflowToolPlugin implements ToolPlugin {
  name = "workflow";
  version = "1.0.0";
  type = "tool" as const;
  description = "Create and execute multi-step automation workflows";

  private workflows = new Map<string, Workflow>();
  private toolExecutor?: (tool: string, args: Record<string, unknown>) => Promise<ToolResult>;
  private log!: PluginContext["log"];

  tools: ToolDefinition[] = [
    {
      name: "create_workflow",
      description: "Create a new automation workflow with multiple steps",
      parameters: {
        name: { type: "string", description: "Workflow name", required: true },
        description: { type: "string", description: "What this workflow does", required: false },
        steps: {
          type: "array",
          description:
            'Array of steps, each with: id, name, tool, args. Use {{stepId.output}} to reference previous step outputs.',
          required: true,
        },
        trigger: {
          type: "object",
          description: 'Trigger config: {type: "manual"} or {type: "cron", schedule: "0 9 * * *"}',
          required: false,
        },
      },
    },
    {
      name: "run_workflow",
      description: "Execute a workflow by name or ID",
      parameters: {
        name: { type: "string", description: "Workflow name or ID", required: true },
        input: { type: "object", description: "Input data for the workflow", required: false },
      },
    },
    {
      name: "list_workflows",
      description: "List all saved workflows",
      parameters: {},
    },
    {
      name: "delete_workflow",
      description: "Delete a workflow by name or ID",
      parameters: {
        name: { type: "string", description: "Workflow name or ID", required: true },
      },
    },
  ];

  setToolExecutor(executor: (tool: string, args: Record<string, unknown>) => Promise<ToolResult>): void {
    this.toolExecutor = executor;
  }

  async init(ctx: PluginContext): Promise<void> {
    this.log = ctx.log;
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (toolName) {
      case "create_workflow":
        return this.createWorkflow(args);
      case "run_workflow":
        return this.runWorkflow(args);
      case "list_workflows":
        return this.listWorkflows();
      case "delete_workflow":
        return this.deleteWorkflow(args);
      default:
        return { success: false, output: "", error: `Unknown tool: ${toolName}` };
    }
  }

  private createWorkflow(args: Record<string, unknown>): ToolResult {
    const name = args["name"] as string;
    const steps = args["steps"] as WorkflowStep[];
    const trigger = (args["trigger"] as WorkflowTrigger) || { type: "manual" };
    const description = args["description"] as string | undefined;

    const workflow: Workflow = {
      id: `wf_${Date.now()}`,
      name,
      description,
      trigger,
      steps,
      createdAt: Date.now(),
    };

    this.workflows.set(workflow.id, workflow);
    this.log.info(`Created workflow: ${name} (${steps.length} steps)`);

    return {
      success: true,
      output: `Workflow "${name}" created with ${steps.length} steps (ID: ${workflow.id})`,
    };
  }

  private async runWorkflow(args: Record<string, unknown>): Promise<ToolResult> {
    const name = args["name"] as string;
    const input = (args["input"] as Record<string, unknown>) || {};

    const workflow = this.findWorkflow(name);
    if (!workflow) {
      return { success: false, output: "", error: `Workflow "${name}" not found` };
    }

    if (!this.toolExecutor) {
      return { success: false, output: "", error: "No tool executor configured" };
    }

    const results = new Map<string, StepResult>();
    const context: Record<string, unknown> = { input, ...input };

    this.log.info(`Running workflow: ${workflow.name}`);

    for (const step of workflow.steps) {
      // Check condition
      if (step.condition) {
        try {
          const conditionResult = new Function("ctx", `with(ctx) { return ${step.condition} }`)(context);
          if (!conditionResult) {
            this.log.debug(`Skipping step ${step.id}: condition not met`);
            continue;
          }
        } catch {
          this.log.warn(`Step ${step.id} condition evaluation failed`);
        }
      }

      // Handle parallel steps
      if (step.parallel && step.parallel.length > 0) {
        const parallelResults = await Promise.all(
          step.parallel.map((s) => this.executeStep(s, context))
        );
        for (const r of parallelResults) {
          results.set(r.stepId, r);
          context[r.stepId] = { output: r.output, data: r.data };
        }
        continue;
      }

      // Execute step
      const result = await this.executeStep(step, context);
      results.set(step.id, result);
      context[step.id] = { output: result.output, data: result.data };

      if (!result.success && step.onError === "stop") {
        break;
      }
    }

    const allResults = [...results.values()];
    const succeeded = allResults.filter((r) => r.success).length;
    const totalMs = allResults.reduce((sum, r) => sum + r.durationMs, 0);

    const summary = allResults
      .map((r) => `  ${r.success ? "OK" : "FAIL"} ${r.stepId}: ${r.output.slice(0, 100)}`)
      .join("\n");

    return {
      success: succeeded === allResults.length,
      output: `Workflow "${workflow.name}" completed: ${succeeded}/${allResults.length} steps succeeded (${totalMs}ms)\n${summary}`,
    };
  }

  private async executeStep(
    step: WorkflowStep,
    context: Record<string, unknown>
  ): Promise<StepResult> {
    const startTime = Date.now();
    let attempts = 0;
    const maxAttempts = step.onError === "retry" ? (step.maxRetries || 3) : 1;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        // Resolve template variables in args
        const resolvedArgs = this.resolveArgs(step.args, context);
        const result = await this.toolExecutor!(step.tool, resolvedArgs);

        return {
          stepId: step.id,
          success: result.success,
          output: result.output,
          data: result.data,
          durationMs: Date.now() - startTime,
        };
      } catch (err) {
        if (attempts >= maxAttempts) {
          return {
            stepId: step.id,
            success: false,
            output: "",
            durationMs: Date.now() - startTime,
          };
        }
        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
      }
    }

    return {
      stepId: step.id,
      success: false,
      output: "Max retries exceeded",
      durationMs: Date.now() - startTime,
    };
  }

  private resolveArgs(
    args: Record<string, unknown>,
    context: Record<string, unknown>
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === "string") {
        resolved[key] = value.replace(/\{\{(\w+)\.(\w+)\}\}/g, (_match, stepId, prop) => {
          const stepCtx = context[stepId];
          if (stepCtx && typeof stepCtx === "object" && stepCtx !== null) {
            return String((stepCtx as Record<string, unknown>)[prop] ?? "");
          }
          return "";
        });
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  private listWorkflows(): ToolResult {
    if (this.workflows.size === 0) {
      return { success: true, output: "No workflows defined." };
    }

    const list = [...this.workflows.values()]
      .map((w) => `- ${w.name} (${w.id}): ${w.steps.length} steps, trigger: ${w.trigger.type}`)
      .join("\n");

    return { success: true, output: `${this.workflows.size} workflows:\n${list}` };
  }

  private deleteWorkflow(args: Record<string, unknown>): ToolResult {
    const name = args["name"] as string;
    const workflow = this.findWorkflow(name);
    if (!workflow) {
      return { success: false, output: "", error: `Workflow "${name}" not found` };
    }

    this.workflows.delete(workflow.id);
    return { success: true, output: `Deleted workflow "${workflow.name}"` };
  }

  private findWorkflow(nameOrId: string): Workflow | undefined {
    return (
      this.workflows.get(nameOrId) ||
      [...this.workflows.values()].find((w) => w.name === nameOrId)
    );
  }
}
