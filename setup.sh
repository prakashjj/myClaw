#!/usr/bin/env bash
#
# MyClaw Quick Setup Script (Linux / macOS)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/prakashjj/myClaw/main/setup.sh | bash
#
#   Or if you've cloned the repo:
#   ./setup.sh
#

set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

info()  { echo -e "${GREEN}[MyClaw]${RESET} $1"; }
warn()  { echo -e "${YELLOW}[MyClaw]${RESET} $1"; }
error() { echo -e "${RED}[MyClaw]${RESET} $1"; }

# ─── Check prerequisites ────────────────────────────────────────────────────

info "Checking prerequisites..."

# Node.js >= 20
if ! command -v node &> /dev/null; then
    error "Node.js is not installed. Install Node.js 20+ from https://nodejs.org"
    exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
    error "Node.js $NODE_MAJOR found, but MyClaw requires Node.js 20+."
    error "Update from https://nodejs.org"
    exit 1
fi
info "Node.js $(node --version) — OK"

# npm
if ! command -v npm &> /dev/null; then
    error "npm is not installed."
    exit 1
fi

# ─── Detect install mode ────────────────────────────────────────────────────

if [ -f "package.json" ] && grep -q '"myclaw"' package.json 2>/dev/null; then
    # We're inside the cloned repo
    info "Detected cloned repo — building from source..."
    INSTALL_MODE="source"
else
    # Fresh install
    info "Installing MyClaw..."
    INSTALL_MODE="clone"
fi

# ─── Install ─────────────────────────────────────────────────────────────────

if [ "$INSTALL_MODE" = "clone" ]; then
    # Clone the repo
    if command -v git &> /dev/null; then
        git clone https://github.com/prakashjj/myClaw.git
        cd myClaw
    else
        error "git is not installed. Install git first, or download the zip from GitHub."
        exit 1
    fi
fi

# Install dependencies and build
info "Installing dependencies..."
npm install

info "Building TypeScript..."
npm run build

# ─── Link globally ───────────────────────────────────────────────────────────

info "Linking 'myclaw' command globally..."
npm link 2>/dev/null || {
    warn "npm link failed (may need sudo). You can still run: npx myclaw"
}

# ─── Initialize ──────────────────────────────────────────────────────────────

info "Initializing config..."
node dist/cli.js init 2>/dev/null || true

# ─── Security lockdown ───────────────────────────────────────────────────────

info "Securing data directory..."
chmod 700 .myclaw 2>/dev/null || true

# ─── Done ────────────────────────────────────────────────────────────────────

echo ""
info "${BOLD}MyClaw installed successfully!${RESET}"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Set your API key (pick one):"
echo "     export ANTHROPIC_API_KEY=sk-ant-..."
echo "     export OPENROUTER_API_KEY=sk-or-..."
echo "     export OPENAI_API_KEY=sk-..."
echo ""
echo "  2. Start chatting:"
echo "     myclaw chat"
echo ""
echo "  3. Run security audit:"
echo "     myclaw secure"
echo ""
echo "  For more: myclaw help"
echo ""
