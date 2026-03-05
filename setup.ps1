#
# MyClaw Quick Setup Script (Windows PowerShell)
#
# Usage:
#   irm https://raw.githubusercontent.com/prakashjj/myClaw/main/setup.ps1 | iex
#
#   Or if you've cloned the repo:
#   .\setup.ps1
#

$ErrorActionPreference = "Stop"

function Write-Info($msg) { Write-Host "[MyClaw] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[MyClaw] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[MyClaw] $msg" -ForegroundColor Red }

# ─── Check prerequisites ────────────────────────────────────────────────────

Write-Info "Checking prerequisites..."

# Node.js >= 20
try {
    $nodeVersion = (node --version) -replace '^v', ''
    $nodeMajor = [int]($nodeVersion.Split('.')[0])
    if ($nodeMajor -lt 20) {
        Write-Err "Node.js $nodeVersion found, but MyClaw requires Node.js 20+."
        Write-Err "Download from https://nodejs.org"
        exit 1
    }
    Write-Info "Node.js v$nodeVersion — OK"
} catch {
    Write-Err "Node.js is not installed. Download from https://nodejs.org"
    exit 1
}

# npm
try {
    npm --version | Out-Null
} catch {
    Write-Err "npm is not available."
    exit 1
}

# ─── Detect install mode ────────────────────────────────────────────────────

$isRepo = (Test-Path "package.json") -and ((Get-Content "package.json" -Raw) -match '"myclaw"')

if ($isRepo) {
    Write-Info "Detected cloned repo — building from source..."
} else {
    Write-Info "Cloning MyClaw..."
    try {
        git clone https://github.com/prakashjj/myClaw.git
        Set-Location myClaw
    } catch {
        Write-Err "git is not installed. Install git first, or download the zip from GitHub."
        exit 1
    }
}

# ─── Install ─────────────────────────────────────────────────────────────────

Write-Info "Installing dependencies..."
npm install

Write-Info "Building TypeScript..."
npm run build

# ─── Link globally ───────────────────────────────────────────────────────────

Write-Info "Linking 'myclaw' command globally..."
try {
    npm link 2>$null
} catch {
    Write-Warn "npm link failed. You can still run: npx myclaw"
}

# ─── Initialize ──────────────────────────────────────────────────────────────

Write-Info "Initializing config..."
try {
    node dist/cli.js init 2>$null
} catch {}

# ─── Security lockdown (Windows NTFS ACLs) ───────────────────────────────────

Write-Info "Securing data directory with NTFS ACLs..."
try {
    $dataDir = ".myclaw"
    if (Test-Path $dataDir) {
        $username = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

        # Remove inheritance
        icacls $dataDir /inheritance:r 2>$null | Out-Null

        # Grant full control only to current user and SYSTEM
        icacls $dataDir /grant:r "${username}:(OI)(CI)F" 2>$null | Out-Null
        icacls $dataDir /grant:r "SYSTEM:(OI)(CI)F" 2>$null | Out-Null

        Write-Info "Data directory secured — only $username and SYSTEM have access"
    }
} catch {
    Write-Warn "Could not lock down .myclaw directory. Run: myclaw secure --fix"
}

# ─── Done ────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Info "MyClaw installed successfully!"
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host ""
Write-Host "  1. Set your API key (pick one):" -ForegroundColor White
Write-Host '     $env:ANTHROPIC_API_KEY = "sk-ant-..."'
Write-Host '     $env:OPENROUTER_API_KEY = "sk-or-..."'
Write-Host '     $env:OPENAI_API_KEY = "sk-..."'
Write-Host ""
Write-Host "  2. Start chatting:" -ForegroundColor White
Write-Host "     myclaw chat"
Write-Host ""
Write-Host "  3. Run security audit:" -ForegroundColor White
Write-Host "     myclaw secure"
Write-Host ""
Write-Host "  For more: myclaw help"
Write-Host ""
