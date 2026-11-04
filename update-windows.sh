#!/usr/bin/env bash
# Publish the Windows build (a ZIP). Easiest: double-click release-windows.cmd, or run ./update-windows.sh with no
# arguments; it remembers the ZIP path and suggests a version. Full form: ./update-windows.sh <path-to-zip> <version> [-y]
# Uploads the ZIP to Cloudflare R2, records it in Supabase (platform windows), then commits the new link in script.js.
# Needs api/.env filled in (Supabase + R2), `npm install` done in api/, and migration 0007 applied in Supabase.
# Works in Git Bash on Windows, macOS and Linux. Run it from anywhere inside this repo.
set -euo pipefail

ZIP_SRC="${1:-}"
VERSION="${2:-}"
ASSUME_YES="${3:-}"

die() { echo "ERROR: $*" >&2; exit 1; }

cd "$(git rev-parse --show-toplevel)"

# No arguments: reuse the last ZIP path (kept in the git-ignored .release-local-windows) and suggest a version.
SAVED_FILE=".release-local-windows"
if [ -z "$ZIP_SRC" ]; then
  SAVED=$(cat "$SAVED_FILE" 2>/dev/null || true)
  read -r -p "Windows ZIP file${SAVED:+ [$SAVED]}: " ZIP_SRC
  ZIP_SRC="${ZIP_SRC:-$SAVED}"
  ZIP_SRC="${ZIP_SRC%\"}"; ZIP_SRC="${ZIP_SRC#\"}"   # drag-and-drop adds quotes
fi
OLD_VERSION=$(sed -n "s/^const WIN_VERSION = '\(.*\)';/\1/p" script.js)
if [ -z "$VERSION" ]; then
  # First Windows release: suggest the game's current version; later ones bump the last number (1.001 -> 1.002).
  BASE="${OLD_VERSION:-$(sed -n "s/^const APK_VERSION = '\(.*\)';/\1/p" script.js)}"
  if [ -n "$OLD_VERSION" ]; then
    SUGGEST=$(printf '%s' "$BASE" | awk -F. '{n=$NF; w=length(n); $NF=sprintf("%0" w "d", n+1)} 1' OFS=.)
  else
    SUGGEST="$BASE"
  fi
  read -r -p "Version [$SUGGEST]: " VERSION
  VERSION="${VERSION:-$SUGGEST}"
fi

[ -n "$ZIP_SRC" ] && [ -n "$VERSION" ] || die "usage: $0 [<path-to-zip> <version> [-y]]"
[ -f "$ZIP_SRC" ] || die "file not found: $ZIP_SRC"
[[ "$VERSION" =~ ^[0-9]+(\.[0-9]+){1,2}$ ]] || die "version must look like 1.1 or 1.1.2, got: $VERSION"

[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "switch to the main branch first (you are on $(git rev-parse --abbrev-ref HEAD))"
# Only script.js is committed, so changes under downloads/ do not matter.
[ -z "$(git status --porcelain -- . ':!downloads')" ] || die "you have uncommitted changes outside downloads/; commit or stash them first"
git pull --ff-only -q origin main || die "could not update main from GitHub"
[ -d api/node_modules ] || die "run 'npm install' in api/ first"

# Make sure it really is a ZIP that holds the Windows game (The Fatty.exe), and not a wrong file such as the APK.
command -v node >/dev/null || die "node is needed to validate the ZIP"
node -e '
const fs = require("fs");
const fd = fs.openSync(process.argv[1], "r");
const size = fs.fstatSync(fd).size;
const read = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b; };
if (size < 22 || read(0, 2).toString("latin1") !== "PK") process.exit(1);
const tailLen = Math.min(size, 65557);
const tail = read(size - tailLen, tailLen);
const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
if (eocd < 0) process.exit(1);
const cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
if (cdOffset + cdSize > size) process.exit(1);
const dir = read(cdOffset, cdSize).toString("latin1");
if (dir.includes("AndroidManifest.xml")) process.exit(2);
process.exit(dir.includes("The Fatty.exe") ? 0 : 3);
' "$ZIP_SRC" && true
case $? in
  0) ;;
  2) die "this looks like an Android APK, use update-apk.sh for it" ;;
  3) die "no \"The Fatty.exe\" inside this ZIP; is it the Windows build?" ;;
  *) die "not a valid ZIP file" ;;
esac

SIZE_BYTES=$(wc -c < "$ZIP_SRC" | tr -d ' ')
SIZE_MB=$(( SIZE_BYTES / 1048576 ))

if command -v sha256sum >/dev/null; then SHA=$(sha256sum "$ZIP_SRC" | cut -d' ' -f1); else SHA=$(shasum -a 256 "$ZIP_SRC" | cut -d' ' -f1); fi

# Dry run first: checks R2 credentials, Supabase, the migration and that the version is new, without uploading.
ABS_ZIP="$(cd "$(dirname "$ZIP_SRC")" && pwd)/$(basename "$ZIP_SRC")"
(cd api && npm run --silent release -- "$ABS_ZIP" "$VERSION" --platform windows --dry-run) || die "pre-flight check failed (see above)"

echo
echo "Publishing Windows:  ${OLD_VERSION:-none yet} -> $VERSION"
echo "ZIP:                 $ZIP_SRC (${SIZE_MB} MB)"
echo "SHA-256:             $SHA"
echo
if [ "$ASSUME_YES" != "-y" ]; then
  read -r -p "Upload to R2, then commit and push to main? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { echo "Cancelled. Nothing changed."; exit 1; }
fi

# stdout of the release script is a single JSON line; progress goes to stderr.
RESULT=$(cd api && npm run --silent release -- "$ABS_ZIP" "$VERSION" --platform windows) || die "upload failed (see above); nothing was committed"
ZIP_URL=$(printf '%s' "$RESULT" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).url")
[ -n "$ZIP_URL" ] || die "could not read the ZIP URL from the release script"

sed -i.bak \
  -e "s|^const WIN_PATH = .*;|const WIN_PATH = '$ZIP_URL';|" \
  -e "s|^const WIN_VERSION = '.*';|const WIN_VERSION = '$VERSION';|" \
  -e "s|^const WIN_SIZE_MB = .*;|const WIN_SIZE_MB = $SIZE_MB;|" script.js && rm -f script.js.bak
grep -q "const WIN_VERSION = '$VERSION';" script.js || die "uploaded, but failed to update script.js; set WIN_PATH=$ZIP_URL by hand"

echo "$ZIP_SRC" > "$SAVED_FILE"
git add script.js
git commit -q -m "Release The Fatty Windows v$VERSION" -m "SHA-256: $SHA"
git push -q origin main

echo
echo "Done. Pages redeploys in 1-2 minutes; the Windows button appears on the site after that."
REPO_URL=$(git remote get-url origin | sed -e 's|\.git$||' -e 's|^git@github\.com:|https://github.com/|')
echo "Progress: $REPO_URL/actions"
