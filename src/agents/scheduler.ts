/**
 * Task Scheduler
 *
 * Cron-like scheduling for autonomous agent tasks.
 * Similar to OpenClaw's scheduling but with better isolation
 * and resource controls.
 */

import type { AgentConfig, Logger } from "../core/types.js";

export interface ScheduledTask {
  id: string;
  /** Cron expression (e.g., "0 9 * * *" for daily at 9am) */
  cron: string;
  /** Agent to execute the task */
  agentId: string;
  /** What to tell the agent to do */
  prompt: string;
  /** Is this task active? */
  enabled: boolean;
  /** Last execution time */
  lastRun?: number;
  /** Next scheduled execution time */
  nextRun?: number;
}

export class TaskScheduler {
  private tasks = new Map<string, ScheduledTask>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private executeCallback?: (agentId: string, prompt: string) => Promise<void>;

  constructor(private log: Logger) {}

  onExecute(callback: (agentId: string, prompt: string) => Promise<void>): void {
    this.executeCallback = callback;
  }

  addTask(task: ScheduledTask): void {
    this.tasks.set(task.id, task);
    if (task.enabled) {
      this.scheduleNext(task);
    }
    this.log.info(`Scheduled task "${task.id}" with cron: ${task.cron}`);
  }

  removeTask(id: string): void {
    this.tasks.delete(id);
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  private scheduleNext(task: ScheduledTask): void {
    const nextMs = this.getNextRunMs(task.cron);
    if (nextMs <= 0) return;

    task.nextRun = Date.now() + nextMs;

    const timer = setTimeout(async () => {
      task.lastRun = Date.now();
      this.log.info(`Executing scheduled task: ${task.id}`);

      try {
        if (this.executeCallback) {
          await this.executeCallback(task.agentId, task.prompt);
        }
      } catch (err) {
        this.log.error(`Scheduled task "${task.id}" failed: ${err}`);
      }

      // Reschedule
      if (task.enabled) {
        this.scheduleNext(task);
      }
    }, nextMs);

    this.timers.set(task.id, timer);
  }

  /**
   * Simple cron parser: supports "* * * * *" format
   * (minute hour day-of-month month day-of-week)
   */
  private getNextRunMs(cron: string): number {
    const parts = cron.split(/\s+/);
    if (parts.length !== 5) return 60_000; // Default: 1 minute

    const now = new Date();
    const next = new Date(now);
    next.setSeconds(0, 0);

    const [minuteStr, hourStr] = parts;

    if (minuteStr !== "*") {
      next.setMinutes(parseInt(minuteStr, 10));
    }
    if (hourStr !== "*") {
      next.setHours(parseInt(hourStr, 10));
    }

    // If next is in the past, advance by the appropriate interval
    if (next.getTime() <= now.getTime()) {
      if (hourStr !== "*") {
        next.setDate(next.getDate() + 1);
      } else if (minuteStr !== "*") {
        next.setHours(next.getHours() + 1);
      } else {
        next.setMinutes(next.getMinutes() + 1);
      }
    }

    return next.getTime() - now.getTime();
  }

  listTasks(): ScheduledTask[] {
    return [...this.tasks.values()];
  }

  stop(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
