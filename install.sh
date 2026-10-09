#!/usr/bin/env bash
# Install or update Jawla (جولة) with one command:
#   curl -fsSL https://raw.githubusercontent.com/osama300/jawla/main/install.sh | bash
# Everything runs inside main() so a partially downloaded script never runs halfway.
set -euo pipefail

REPO="osama300/jawla"
TARBALL="https://codeload.github.com/${REPO}/tar.gz/refs/heads/main"
PORT="${PORT:-4477}"

say() { printf '\033[1;32m›\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

main() {
  case "$(uname -s)" in
    Darwin | Linux) ;;
    *) die "Jawla supports macOS and Linux only." ;;
  esac

  # Node.js 20+
  if ! command -v node >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      say "Node.js not found — installing it with Homebrew…"
      brew install node </dev/null
    else
      die "Jawla needs Node.js 20 or newer. Install it from https://nodejs.org and run this command again."
    fi
  fi
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 20 ] || die "Jawla needs Node.js 20 or newer (you have $(node -v)). Update it (brew upgrade node) and run this command again."

  if ! command -v claude >/dev/null 2>&1 && ! command -v codex >/dev/null 2>&1; then
    warn "Neither Claude Code nor Codex was found. Jawla will open, but it reads their sessions and uses them for summaries."
  fi

  # The global npm folder may belong to root (Node installed from nodejs.org): use sudo only for that step
  local prefix npm=(npm)
  prefix="$(npm prefix -g)"
  [ -d "$prefix/lib" ] && prefix="$prefix/lib"
  if [ ! -w "$prefix" ]; then
    warn "Your global npm folder needs admin rights — you may be asked for your password."
    npm=(sudo npm)
  fi

  say "Installing Jawla…"
  "${npm[@]}" install -g --prefer-online --no-fund --no-audit "$TARBALL" </dev/null

  # An older version still running would keep serving old files: stop it (launchd restarts it when autostart is on)
  local pids
  pids="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then kill $pids 2>/dev/null || true; fi

  say "Connecting Jawla to Claude Code…"
  jawla install </dev/null
  jawla open </dev/null

  echo
  say "Done. Jawla is at http://localhost:${PORT}"
  echo "  • Open it any time: jawla  (or /jawla inside Claude Code, or \"Jawla\" in Spotlight)"
  echo "  • Start it with your Mac: jawla autostart on"
  echo "  • Update: run the same install command again"
  echo "  • Remove: jawla uninstall && npm rm -g jawla"
}

main "$@"
