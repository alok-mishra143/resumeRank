#!/usr/bin/env bash
# resumerank installer — local, offline-first resume ranking.
#
#   curl -fsSL https://raw.githubusercontent.com/alok-mishra143/resumerank/main/install.sh | bash
#
# Options (env vars):
#   RESUMERANK_REPO    git URL or GitHub slug to install from
#   RESUMERANK_REF     branch/tag to install (default: main)
#   RESUMERANK_DIR     where the app lives (default: ~/.resumerank-app)
#   RESUMERANK_BIN     where the launcher goes (default: ~/.local/bin)
#   RESUMERANK_HOME    where your data lives (default: ~/.resumerank)
#
# Nothing here needs sudo, a database or a cloud account.

set -euo pipefail

INSTALL_MARKER=".resumerank-install"

REPO="${RESUMERANK_REPO:-https://github.com/alok-mishra143/resumerank}"
REF="${RESUMERANK_REF:-main}"
APP_DIR="${RESUMERANK_DIR:-$HOME/.resumerank-app}"
BIN_DIR="${RESUMERANK_BIN:-$HOME/.local/bin}"
DATA_DIR="${RESUMERANK_HOME:-$HOME/.resumerank}"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1"; }
die() { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but was not found on PATH"; }

bold "resumerank install"

# ---------------------------------------------------------------- prerequisites
need node
need curl
need tar

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node.js 20 or newer is required (found $(node -v)). Install it from https://nodejs.org or via nvm."
fi
info "node $(node -v)"

# ---------------------------------------------------------------------- download
TMP="$(mktemp -d "${TMPDIR:-/tmp}/resumerank-install.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

tar_url="$REPO/archive/refs/heads/$REF.tar.gz"
case "$REPO" in
  *github.com*) tar_url="$(printf '%s' "$REPO" | sed 's#/*$##')/archive/refs/heads/$REF.tar.gz" ;;
esac

if [ -f "$REPO/package.json" ]; then
  # Installing from a local checkout: just copy it.
  info "installing from the local checkout $REPO"
  mkdir -p "$APP_DIR"
  tar -C "$REPO" --exclude node_modules --exclude .git --exclude corpus-real --exclude .env --exclude ".env.*" -cf - . | tar -C "$APP_DIR" -xf -
elif curl -fsSL --max-time 120 "$tar_url" -o "$TMP/src.tar.gz" 2>/dev/null; then
  info "downloaded $tar_url"
  mkdir -p "$TMP/unpack"
  tar -xzf "$TMP/src.tar.gz" -C "$TMP/unpack"
  inner="$(find "$TMP/unpack" -maxdepth 1 -mindepth 1 -type d | head -1)"
  [ -n "$inner" ] || die "the downloaded archive had an unexpected layout"
  rm -rf "$APP_DIR"
  mkdir -p "$APP_DIR"
  (cd "$inner" && tar --exclude node_modules --exclude .git --exclude corpus-real --exclude .env --exclude ".env.*" -cf - .) | tar -C "$APP_DIR" -xf -
elif command -v git >/dev/null 2>&1; then
  info "tarball download failed, cloning with git instead"
  rm -rf "$APP_DIR"
  git clone --depth 1 --branch "$REF" "$REPO" "$APP_DIR" >/dev/null 2>&1 || die "git clone failed for $REPO"
else
  die "could not download $tar_url and git is not installed"
fi

[ -f "$APP_DIR/package.json" ] || die "no package.json in $APP_DIR — wrong repo?"

# ------------------------------------------------------------------- dependencies
cd "$APP_DIR"

if [ -f dist/resumerank.js ]; then
  # A prebuilt bundle ships with the repo, so only the runtime deps are needed.
  info "installing runtime dependencies (prebuilt bundle found)…"
  npm install --omit=dev --no-audit --no-fund --silent
else
  info "installing dependencies and building…"
  npm install --no-audit --no-fund --silent
  npm run build --silent
fi

[ -f dist/resumerank.js ] || die "build did not produce dist/resumerank.js"

# ----------------------------------------------------------------------- launcher
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/resumerank" <<LAUNCHER
#!/usr/bin/env bash
exec node "$APP_DIR/dist/resumerank.js" "\$@"
LAUNCHER
chmod +x "$BIN_DIR/resumerank"
info "launcher: $BIN_DIR/resumerank"

mkdir -p "$DATA_DIR"
info "data dir: $DATA_DIR"

# Marker so `resumerank uninstall` can tell an installed copy from a source
# checkout (and therefore knows whether it may delete the program files).
VERSION="$("$BIN_DIR/resumerank" --version 2>/dev/null || echo 0.0.0)"
cat > "$APP_DIR/$INSTALL_MARKER" <<MARKER
{"version":"$VERSION","installedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","mode":"install","dir":"$APP_DIR","bin":"$BIN_DIR/resumerank"}
MARKER
info "install marker: $APP_DIR/$INSTALL_MARKER"

# ------------------------------------------------------------------------- check
if "$BIN_DIR/resumerank" --version >/dev/null 2>&1; then
  info "installed $("$BIN_DIR/resumerank" --version)"
else
  warn "the launcher could not be executed — try: node $APP_DIR/dist/resumerank.js --help"
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR is not on your PATH. Add it:  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac

# --------------------------------------------------------- desktop entry (GUI)
# A non-technical user should be able to open the app from the applications menu
# instead of typing a command: write a .desktop launcher plus its icon.
APPS_DIR="${RESUMERANK_APPS_DIR:-$HOME/.local/share/applications}"
ICONS_DIR="${RESUMERANK_ICONS_DIR:-$HOME/.local/share/icons}"
if mkdir -p "$APPS_DIR" "$ICONS_DIR" 2>/dev/null; then
  if [ -f "$APP_DIR/assets/resumerank.svg" ]; then
    cp "$APP_DIR/assets/resumerank.svg" "$ICONS_DIR/resumerank.svg" 2>/dev/null && info "icon: $ICONS_DIR/resumerank.svg"
  fi
  cat > "$APPS_DIR/resumerank.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=resumerank
Comment=Rank resumes locally against a job description
Exec=$BIN_DIR/resumerank ui
Icon=$ICONS_DIR/resumerank.svg
Terminal=false
Categories=Office;Utility;
Keywords=resume;cv;hiring;ranking;
StartupNotify=true
DESKTOP
  chmod +x "$APPS_DIR/resumerank.desktop" 2>/dev/null || true
  info "application menu entry: resumerank (opens the web UI in your browser)"
fi

echo
bold "Done. Next:"
cat <<NEXT
  resumerank ui                 # open the app in your browser (the normal way in)
  resumerank dashboard          # one self-contained HTML file you can send or print
  resumerank dash               # terminal dashboard, if you live in a shell
  resumerank add ~/resumes/*.pdf
  resumerank rank --title "Senior Backend Engineer" --jd job.md

  Optional: add a TypeSafe (Jev) key in the UI under Settings for the typed
  extraction layer. Without a key every feature still works, fully offline.
NEXT
