/**
 * MyClaw Security Module — Audit Logging, RBAC, Rate Limiting
 *
 * Enterprise-grade security that no other claw has:
 * - Full audit trail of every action (tool calls, messages, config changes)
 * - Role-Based Access Control (admin, operator, user, viewer)
 * - Per-user and per-channel rate limiting with sliding window
 * - Sensitive data redaction in logs
 * - Tamper-evident audit log (hash chain)
 */

import { appendFile, readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

// ─── Audit Logging ──────────────────────────────────────────────────────────

export interface AuditEntry {
  timestamp: number;
  /** ISO date string */
  date: string;
  /** Who performed the action */
  actor: string;
  /** What happened */
  action: AuditAction;
  /** Target resource */
  resource: string;
  /** Additional details */
  details?: Record<string, unknown>;
  /** Result of the action */
  result: "success" | "denied" | "error";
  /** Hash of previous entry (tamper-evident chain) */
  prevHash: string;
  /** Hash of this entry */
  hash: string;
}

export type AuditAction =
  | "tool.execute"
  | "tool.denied"
  | "message.received"
  | "message.sent"
  | "agent.start"
  | "agent.stop"
  | "config.change"
  | "plugin.load"
  | "plugin.unload"
  | "auth.login"
  | "auth.denied"
  | "rate.limited"
  | "sandbox.violation"
  | "path.violation";

export class AuditLogger {
  private logPath: string;
  private lastHash = "genesis";
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private sensitivePatterns: RegExp[] = [
    /sk-ant-[a-zA-Z0-9_-]+/g,       // Anthropic API keys
    /sk-[a-zA-Z0-9]{20,}/g,          // OpenAI API keys
    /xoxb-[a-zA-Z0-9-]+/g,           // Slack tokens
    /\b\d{10}:[A-Za-z0-9_-]{35}\b/g, // Telegram bot tokens
    /password["']?\s*[:=]\s*["'][^"']+/gi,
  ];

  constructor(dataDir: string) {
    this.logPath = join(dataDir, "audit.jsonl");
  }

  async init(): Promise<void> {
    const dir = join(this.logPath, "..");
    await mkdir(dir, { recursive: true });

    // Load last hash from existing log
    try {
      const content = await readFile(this.logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      if (lines.length > 0) {
        const lastEntry = JSON.parse(lines[lines.length - 1]) as AuditEntry;
        this.lastHash = lastEntry.hash;
      }
    } catch {
      // Fresh log
    }

    // Flush buffer every 5 seconds
    this.flushTimer = setInterval(() => this.flush(), 5000);
  }

  async log(
    actor: string,
    action: AuditAction,
    resource: string,
    result: AuditEntry["result"],
    details?: Record<string, unknown>
  ): Promise<void> {
    const now = Date.now();
    const sanitizedDetails = details ? this.redactSensitive(details) : undefined;

    const entry: Omit<AuditEntry, "hash"> & { hash?: string } = {
      timestamp: now,
      date: new Date(now).toISOString(),
      actor,
      action,
      resource,
      result,
      details: sanitizedDetails,
      prevHash: this.lastHash,
    };

    // Hash chain for tamper evidence
    const hash = createHash("sha256")
      .update(JSON.stringify(entry))
      .digest("hex")
      .slice(0, 16);

    entry.hash = hash;
    this.lastHash = hash;

    this.buffer.push(JSON.stringify(entry));

    // Immediate flush for security events
    if (action === "sandbox.violation" || action === "path.violation" || action === "auth.denied") {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const data = this.buffer.join("\n") + "\n";
    this.buffer = [];

    try {
      await appendFile(this.logPath, data, "utf-8");
    } catch (err) {
      console.error(`[AuditLogger] Failed to write: ${err}`);
      // Re-add to buffer for retry
      this.buffer.unshift(...data.trim().split("\n"));
    }
  }

  private redactSensitive(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        let redacted = value;
        for (const pattern of this.sensitivePatterns) {
          redacted = redacted.replace(pattern, "[REDACTED]");
        }
        result[key] = redacted;
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        result[key] = this.redactSensitive(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  async destroy(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
  }
}

// ─── Role-Based Access Control ──────────────────────────────────────────────

export type Role = "admin" | "operator" | "user" | "viewer";

export interface Permission {
  /** Tools this role can use (glob patterns) */
  tools: string[];
  /** Channels this role can access */
  channels: string[];
  /** Can modify agent config? */
  configWrite: boolean;
  /** Can view audit logs? */
  auditRead: boolean;
  /** Max messages per minute */
  rateLimit: number;
  /** Can use dangerous tools (shell, filesystem write)? */
  dangerousTools: boolean;
}

const DEFAULT_PERMISSIONS: Record<Role, Permission> = {
  admin: {
    tools: ["*"],
    channels: ["*"],
    configWrite: true,
    auditRead: true,
    rateLimit: 1000,
    dangerousTools: true,
  },
  operator: {
    tools: ["*"],
    channels: ["*"],
    configWrite: false,
    auditRead: true,
    rateLimit: 200,
    dangerousTools: true,
  },
  user: {
    tools: ["remember", "recall", "list_memories", "web_search", "fetch_url", "execute_code", "create_workflow", "run_workflow"],
    channels: ["*"],
    configWrite: false,
    auditRead: false,
    rateLimit: 30,
    dangerousTools: false,
  },
  viewer: {
    tools: [],
    channels: ["*"],
    configWrite: false,
    auditRead: false,
    rateLimit: 10,
    dangerousTools: false,
  },
};

export interface UserRecord {
  userId: string;
  role: Role;
  channels?: string[];
  customPermissions?: Partial<Permission>;
}

export class AccessControl {
  private users = new Map<string, UserRecord>();
  private permissions: Record<Role, Permission>;

  constructor(
    customPermissions?: Partial<Record<Role, Partial<Permission>>>,
    users?: UserRecord[]
  ) {
    this.permissions = { ...DEFAULT_PERMISSIONS };
    if (customPermissions) {
      for (const [role, perms] of Object.entries(customPermissions)) {
        this.permissions[role as Role] = {
          ...DEFAULT_PERMISSIONS[role as Role],
          ...perms,
        };
      }
    }
    if (users) {
      for (const user of users) {
        this.users.set(user.userId, user);
      }
    }
  }

  getRole(userId: string): Role {
    return this.users.get(userId)?.role || "user";
  }

  setRole(userId: string, role: Role): void {
    const existing = this.users.get(userId);
    if (existing) {
      existing.role = role;
    } else {
      this.users.set(userId, { userId, role });
    }
  }

  canUseTool(userId: string, toolName: string): boolean {
    const perms = this.getPermissions(userId);
    if (perms.tools.includes("*")) return true;
    return perms.tools.some((pattern) => {
      if (pattern === toolName) return true;
      if (pattern.endsWith("*")) return toolName.startsWith(pattern.slice(0, -1));
      return false;
    });
  }

  canAccessChannel(userId: string, channelId: string): boolean {
    const perms = this.getPermissions(userId);
    if (perms.channels.includes("*")) return true;
    return perms.channels.includes(channelId);
  }

  canUseDangerousTools(userId: string): boolean {
    return this.getPermissions(userId).dangerousTools;
  }

  canWriteConfig(userId: string): boolean {
    return this.getPermissions(userId).configWrite;
  }

  canReadAudit(userId: string): boolean {
    return this.getPermissions(userId).auditRead;
  }

  getRateLimit(userId: string): number {
    return this.getPermissions(userId).rateLimit;
  }

  private getPermissions(userId: string): Permission {
    const user = this.users.get(userId);
    const role = user?.role || "user";
    const basePerms = this.permissions[role];

    if (user?.customPermissions) {
      return { ...basePerms, ...user.customPermissions };
    }
    return basePerms;
  }
}

// ─── Rate Limiter (Sliding Window) ──────────────────────────────────────────

interface RateWindow {
  timestamps: number[];
}

export class RateLimiter {
  private windows = new Map<string, RateWindow>();
  private windowMs: number;
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(windowMs = 60_000) {
    this.windowMs = windowMs;
    // Cleanup old entries every minute
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
  }

  /**
   * Check if a request is allowed under the rate limit.
   * Returns { allowed: true } or { allowed: false, retryAfterMs }.
   */
  check(key: string, limit: number): { allowed: boolean; retryAfterMs?: number; remaining: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let window = this.windows.get(key);
    if (!window) {
      window = { timestamps: [] };
      this.windows.set(key, window);
    }

    // Remove expired timestamps
    window.timestamps = window.timestamps.filter((t) => t > cutoff);

    if (window.timestamps.length >= limit) {
      const oldestInWindow = window.timestamps[0];
      const retryAfterMs = oldestInWindow + this.windowMs - now;
      return { allowed: false, retryAfterMs, remaining: 0 };
    }

    window.timestamps.push(now);
    return { allowed: true, remaining: limit - window.timestamps.length };
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, window] of this.windows) {
      window.timestamps = window.timestamps.filter((t) => t > cutoff);
      if (window.timestamps.length === 0) {
        this.windows.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
  }
}

// ─── Secure Installation Validator ──────────────────────────────────────────

export interface InstallationReport {
  secure: boolean;
  checks: InstallationCheck[];
  recommendations: string[];
}

export interface InstallationCheck {
  name: string;
  passed: boolean;
  details: string;
  severity: "critical" | "warning" | "info";
}

/**
 * Validates the security posture of a MyClaw installation.
 * Run this before starting in production.
 */
export async function validateInstallation(dataDir: string): Promise<InstallationReport> {
  const checks: InstallationCheck[] = [];
  const recommendations: string[] = [];

  // 1. Check data directory permissions
  try {
    const { statSync } = await import("node:fs");
    const stats = statSync(dataDir);
    const mode = stats.mode & 0o777;
    const isSecure = (mode & 0o077) === 0; // No group/other access

    checks.push({
      name: "Data directory permissions",
      passed: isSecure,
      details: isSecure
        ? `${dataDir} has restricted permissions (${mode.toString(8)})`
        : `${dataDir} is world-readable (${mode.toString(8)}). Run: chmod 700 ${dataDir}`,
      severity: "critical",
    });

    if (!isSecure) {
      recommendations.push(`chmod 700 ${dataDir}`);
    }
  } catch {
    checks.push({
      name: "Data directory permissions",
      passed: false,
      details: `Cannot stat ${dataDir}`,
      severity: "critical",
    });
  }

  // 2. Check for API keys in config files (should be in env vars, not files)
  try {
    const { readFileSync, existsSync } = await import("node:fs");
    const configPaths = ["myclaw.json", ".myclaw/config.json"];
    for (const configPath of configPaths) {
      if (existsSync(configPath)) {
        const content = readFileSync(configPath, "utf-8");
        const hasKeys = /sk-ant-|sk-[a-z0-9]{20,}|xoxb-/i.test(content);
        checks.push({
          name: `No secrets in ${configPath}`,
          passed: !hasKeys,
          details: hasKeys
            ? "API keys found in config file! Move them to environment variables."
            : "No secrets detected in config file",
          severity: hasKeys ? "critical" : "info",
        });
        if (hasKeys) {
          recommendations.push(`Move API keys from ${configPath} to environment variables`);
        }
      }
    }
  } catch {
    // Skip
  }

  // 3. Check Node.js version
  const nodeVersion = parseInt(process.versions.node.split(".")[0], 10);
  checks.push({
    name: "Node.js version",
    passed: nodeVersion >= 20,
    details: nodeVersion >= 20
      ? `Node.js ${process.versions.node} (supported)`
      : `Node.js ${process.versions.node} is outdated. MyClaw requires Node.js 20+`,
    severity: nodeVersion >= 20 ? "info" : "critical",
  });

  // 4. Check if running as root
  const isRoot = process.getuid?.() === 0;
  checks.push({
    name: "Not running as root",
    passed: !isRoot,
    details: isRoot
      ? "Running as root is dangerous. Create a dedicated myclaw user."
      : "Running as non-root user (good)",
    severity: isRoot ? "warning" : "info",
  });
  if (isRoot) {
    recommendations.push("Create a dedicated 'myclaw' user: useradd -r -s /bin/false myclaw");
  }

  // 5. Check sandbox availability
  try {
    const { execSync } = await import("node:child_process");
    execSync("which docker", { stdio: "pipe" });
    checks.push({
      name: "Docker available for container sandbox",
      passed: true,
      details: "Docker is installed — container sandbox mode available",
      severity: "info",
    });
  } catch {
    checks.push({
      name: "Docker available for container sandbox",
      passed: true, // Not a failure — process sandbox works without Docker
      details: "Docker not found. Process sandbox will be used (still secure).",
      severity: "info",
    });
  }

  // 6. Check for .env file security
  try {
    const { existsSync, statSync: stat2 } = await import("node:fs");
    if (existsSync(".env")) {
      const envStats = stat2(".env");
      const envMode = envStats.mode & 0o777;
      const envSecure = (envMode & 0o077) === 0;
      checks.push({
        name: ".env file permissions",
        passed: envSecure,
        details: envSecure
          ? `.env has restricted permissions (${envMode.toString(8)})`
          : `.env is readable by others (${envMode.toString(8)}). Run: chmod 600 .env`,
        severity: envSecure ? "info" : "warning",
      });
      if (!envSecure) {
        recommendations.push("chmod 600 .env");
      }
    }
  } catch {
    // No .env — that's fine
  }

  const allCriticalPassed = checks
    .filter((c) => c.severity === "critical")
    .every((c) => c.passed);

  return {
    secure: allCriticalPassed,
    checks,
    recommendations,
  };
}
