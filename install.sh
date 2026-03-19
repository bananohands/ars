#!/bin/sh
# Agent Recovery Service — one-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/bananohands/ars/main/install.sh | sh

set -e

REPO="https://github.com/bananohands/ars"
RAW="https://raw.githubusercontent.com/bananohands/ars/main"
INSTALL_DIR="$HOME/.ars"

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║   Agent Recovery Service  v1.0.0      ║"
echo "  ║   The Claw Persists                   ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""

# ── Check Node ────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js not found. Install it from https://nodejs.org (v18+) and re-run."
  exit 1
fi

NODE_VER=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
if [ "$NODE_VER" -lt 18 ]; then
  echo "✗ Node.js v18+ required (you have v$NODE_VER). Update at https://nodejs.org"
  exit 1
fi
echo "✓ Node.js v$(node --version | tr -d 'v') found"

# ── Check git ─────────────────────────────────────────────────────────────────
if ! command -v git >/dev/null 2>&1; then
  echo "✗ git not found. Install git and re-run."
  exit 1
fi
echo "✓ git found"

# ── Clone or update ───────────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "→ Updating existing installation at $INSTALL_DIR ..."
  cd "$INSTALL_DIR"
  git pull --quiet origin main
else
  echo "→ Installing to $INSTALL_DIR ..."
  git clone --quiet "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ── Install dependencies ──────────────────────────────────────────────────────
echo "→ Installing dependencies (this downloads Electron — may take a few minutes)..."
npm install --silent

# ── Create launcher script ────────────────────────────────────────────────────
LAUNCHER="$HOME/.local/bin/ars"
mkdir -p "$HOME/.local/bin"
cat > "$LAUNCHER" << EOF
#!/bin/sh
cd "$INSTALL_DIR" && npm start
EOF
chmod +x "$LAUNCHER"

# Also try /usr/local/bin if writable
if [ -w "/usr/local/bin" ]; then
  cp "$LAUNCHER" /usr/local/bin/ars
fi

echo ""
echo "  ✓ Agent Recovery Service installed successfully!"
echo ""
echo "  Run it:"
echo "    ars"
echo ""
echo "  Or manually:"
echo "    cd $INSTALL_DIR && npm start"
echo ""
echo "  Source: $REPO"
echo ""
