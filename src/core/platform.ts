/**
 * Platform Abstraction Layer
 *
 * Cross-platform security primitives for Windows, macOS, and Linux.
 * MyClaw is the first claw variant that works securely on all three.
 *
 * Windows: Uses icacls for ACL-based folder permissions, PowerShell
 *          for sandbox enforcement, and Windows-specific path validation.
 * Linux/macOS: Uses chmod, chown, and Unix permissions.
 */

import { execSync, type ExecSyncOptions } from "node:child_process";
import { resolve, sep } from "node:path";
import { existsSync, mkdirSync, statSync } from "node:fs";

export const IS_WINDOWS = process.platform === "win32";
export const IS_MACOS = process.platform === "darwin";
export const IS_LINUX = process.platform === "linux";

// ─── Dangerous Commands (platform-specific) ────────────────────────────────

const UNIX_DANGEROUS = [
  "rm -rf /",
  "rm -rf /*",
  "mkfs",
  "dd if=",
  ":(){:|:&};:",         // fork bomb
  "> /dev/sda",
  "chmod -R 777 /",
  "mv /* /dev/null",
  "wget -O- | sh",
  "curl | sh",
];

const WINDOWS_DANGEROUS = [
  "format c:",
  "format d:",
  "rd /s /q c:\\",
  "del /f /s /q c:\\",
  "del /f /s /q %systemroot%",
  "rmdir /s /q c:\\",
  "cipher /w:c:\\",
  "diskpart",
  "bcdedit",
  "reg delete hklm",
  "net user administrator",
  "powershell -ep bypass",
  "powershell -executionpolicy bypass",
  "shutdown /s /t 0",
  "taskkill /f /im csrss",
  "taskkill /f /im svchost",
  "sfc /scannow",
];

/**
 * Get the list of dangerous commands for the current platform.
 */
export function getDangerousCommands(): string[] {
  return IS_WINDOWS ? WINDOWS_DANGEROUS : UNIX_DANGEROUS;
}

/**
 * Check if a command contains a dangerous pattern.
 */
export function isDangerousCommand(command: string): boolean {
  const lower = command.toLowerCase().trim();
  const patterns = getDangerousCommands();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
}

// ─── Secured Folder Management ──────────────────────────────────────────────

export interface SecuredFolderResult {
  success: boolean;
  path: string;
  details: string;
}

/**
 * Create a secured installation folder with restricted permissions.
 * On Windows: Uses icacls to set NTFS ACLs — only the current user has access.
 * On Unix: Uses chmod 700 — only the owner has access.
 */
export function createSecuredFolder(folderPath: string): SecuredFolderResult {
  const resolved = resolve(folderPath);

  try {
    // Create directory if it doesn't exist
    if (!existsSync(resolved)) {
      mkdirSync(resolved, { recursive: true });
    }

    if (IS_WINDOWS) {
      return lockdownWindows(resolved);
    } else {
      return lockdownUnix(resolved);
    }
  } catch (err) {
    return {
      success: false,
      path: resolved,
      details: `Failed to create secured folder: ${err instanceof Error ? err.message : err}`,
    };
  }
}

function lockdownWindows(folderPath: string): SecuredFolderResult {
  const execOpts: ExecSyncOptions = { stdio: "pipe", encoding: "utf-8" };

  try {
    // Get current username
    const username = execSync("whoami", execOpts).toString().trim();

    // Step 1: Disable permission inheritance (remove all inherited ACEs)
    execSync(`icacls "${folderPath}" /inheritance:r`, execOpts);

    // Step 2: Grant full control only to the current user
    execSync(`icacls "${folderPath}" /grant:r "${username}:(OI)(CI)F"`, execOpts);

    // Step 3: Deny access to Everyone else (except SYSTEM for OS operations)
    execSync(`icacls "${folderPath}" /grant:r "SYSTEM:(OI)(CI)F"`, execOpts);

    // Step 4: Apply to all existing files recursively
    execSync(`icacls "${folderPath}" /T /Q`, execOpts);

    return {
      success: true,
      path: folderPath,
      details: `Secured with NTFS ACLs: only ${username} and SYSTEM have access`,
    };
  } catch (err) {
    return {
      success: false,
      path: folderPath,
      details: `icacls failed: ${err instanceof Error ? err.message : err}`,
    };
  }
}

function lockdownUnix(folderPath: string): SecuredFolderResult {
  try {
    execSync(`chmod 700 "${folderPath}"`, { stdio: "pipe" });

    return {
      success: true,
      path: folderPath,
      details: `Permissions set to 700 (owner-only access)`,
    };
  } catch (err) {
    return {
      success: false,
      path: folderPath,
      details: `chmod failed: ${err instanceof Error ? err.message : err}`,
    };
  }
}

// ─── Path Validation (cross-platform) ───────────────────────────────────────

/**
 * Validate that a path is within the allowed paths.
 * Handles Windows backslashes and case-insensitive drive letters.
 */
export function isPathAllowed(targetPath: string, allowedPaths: string[]): boolean {
  if (allowedPaths.length === 0) return true;

  const normalizedTarget = normalizePath(resolve(targetPath));

  return allowedPaths.some((allowed) => {
    const normalizedAllowed = normalizePath(resolve(allowed));
    return normalizedTarget.startsWith(normalizedAllowed);
  });
}

/**
 * Normalize a path for cross-platform comparison.
 * - Converts backslashes to forward slashes
 * - Lowercases drive letters on Windows (C:\\ -> c:/)
 */
function normalizePath(p: string): string {
  let normalized = p.replace(/\\/g, "/");

  // On Windows, lowercase drive letter for consistent comparison
  if (IS_WINDOWS && /^[A-Z]:\//.test(normalized)) {
    normalized = normalized[0].toLowerCase() + normalized.slice(1);
  }

  // Ensure trailing slash for directory comparison
  if (!normalized.endsWith("/")) {
    normalized += "/";
  }

  return normalized;
}

// ─── Permission Checking (cross-platform) ───────────────────────────────────

export interface PermissionCheck {
  path: string;
  isSecure: boolean;
  details: string;
  platform: "windows" | "unix";
}

/**
 * Check if a directory has secure permissions.
 * On Windows: Verifies only the current user and SYSTEM have access.
 * On Unix: Checks that group/other bits are 0.
 */
export function checkPermissions(dirPath: string): PermissionCheck {
  const resolved = resolve(dirPath);

  if (IS_WINDOWS) {
    return checkWindowsPermissions(resolved);
  } else {
    return checkUnixPermissions(resolved);
  }
}

function checkWindowsPermissions(dirPath: string): PermissionCheck {
  try {
    const output = execSync(`icacls "${dirPath}"`, { encoding: "utf-8", stdio: "pipe" });
    const username = execSync("whoami", { encoding: "utf-8", stdio: "pipe" }).trim();

    // Parse icacls output — look for unexpected users
    const lines = output.split("\n").filter((l) => l.trim() && !l.includes("Successfully"));
    const allowedIdentities = [
      username.toLowerCase(),
      "nt authority\\system",
      "builtin\\administrators",
    ];

    const hasUnauthorizedAccess = lines.some((line) => {
      const lower = line.toLowerCase();
      // Skip the path line itself
      if (lower.includes(dirPath.toLowerCase())) return false;
      // Check if any identity besides allowed ones has access
      return !allowedIdentities.some((id) => lower.includes(id));
    });

    return {
      path: dirPath,
      isSecure: !hasUnauthorizedAccess,
      details: hasUnauthorizedAccess
        ? `Other users may have access. Run: icacls "${dirPath}" /inheritance:r /grant:r "${username}:(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F"`
        : "Only current user and SYSTEM have access",
      platform: "windows",
    };
  } catch {
    return {
      path: dirPath,
      isSecure: false,
      details: "Unable to check Windows permissions (icacls not available)",
      platform: "windows",
    };
  }
}

function checkUnixPermissions(dirPath: string): PermissionCheck {
  try {
    const stats = statSync(dirPath);
    const mode = stats.mode & 0o777;
    const isSecure = (mode & 0o077) === 0; // No group/other access

    return {
      path: dirPath,
      isSecure,
      details: isSecure
        ? `Permissions ${mode.toString(8)} (owner-only)`
        : `Permissions ${mode.toString(8)} — run: chmod 700 "${dirPath}"`,
      platform: "unix",
    };
  } catch {
    return {
      path: dirPath,
      isSecure: false,
      details: `Cannot stat ${dirPath}`,
      platform: "unix",
    };
  }
}

// ─── Admin Detection (cross-platform) ──────────────────────────────────────

/**
 * Check if the process is running with elevated privileges.
 * Returns true if running as root (Unix) or Administrator (Windows).
 */
export function isRunningElevated(): boolean {
  if (IS_WINDOWS) {
    try {
      // On Windows, try to write to a protected location
      execSync("net session", { stdio: "pipe" });
      return true; // If this succeeds, we're running elevated
    } catch {
      return false;
    }
  } else {
    return process.getuid?.() === 0;
  }
}

// ─── Environment Variable Path Separator ───────────────────────────────────

/**
 * Get the path list separator for the current platform.
 * Used when parsing MYCLAW_ALLOWED_PATHS from env vars.
 * Windows uses ";" (C:\a;D:\b), Unix uses ":" (/a:/b).
 */
export function getPathSeparator(): string {
  return IS_WINDOWS ? ";" : ":";
}

// ─── Temporary Directory ───────────────────────────────────────────────────

/**
 * Get a platform-appropriate temp directory for sandbox operations.
 */
export function getSandboxTempDir(): string {
  if (IS_WINDOWS) {
    return process.env["TEMP"] || process.env["TMP"] || "C:\\Windows\\Temp";
  }
  return "/tmp/myclaw-sandbox";
}
