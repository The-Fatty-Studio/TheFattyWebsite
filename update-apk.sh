#!/usr/bin/env bash
# Publish a new APK. Easiest: double-click release.cmd (or run ./update-apk.sh with no arguments);
# it remembers the APK path and suggests the next version. Full form: ./update-apk.sh <path-to-apk> <version> [-y]
# Example:          ./update-apk.sh "../The Belt/APKs/TheFatty.apk" 1.1
# Uploads the APK to Cloudflare R2, records it in Supabase, then commits the new link in script.js.
# Needs api/.env filled in (Supabase + R2) and `npm install` done in api/.
# Works in Git Bash on Windows, macOS and Linux. Run it from anywhere inside this repo.
set -euo pipefail

APK_SRC="${1:-}"
VERSION="${2:-}"
ASSUME_YES="${3:-}"

die() { echo "ERROR: $*" >&2; exit 1; }

cd "$(git rev-parse --show-toplevel)"

# No arguments: reuse the last APK path (kept in the git-ignored .release-local) and suggest the next version.
SAVED_FILE=".release-local"
if [ -z "$APK_SRC" ]; then
  SAVED=$(cat "$SAVED_FILE" 2>/dev/null || true)
  read -r -p "APK file${SAVED:+ [$SAVED]}: " APK_SRC
  APK_SRC="${APK_SRC:-$SAVED}"
  APK_SRC="${APK_SRC%\"}"; APK_SRC="${APK_SRC#\"}"   # drag-and-drop adds quotes
fi
if [ -z "$VERSION" ]; then
  CUR=$(sed -n "s/^const APK_VERSION = '\(.*\)';/\1/p" script.js)
  # Bump the last number, keeping its zero padding (1.001 -> 1.002, 1.9 -> 1.10).
  SUGGEST=$(printf '%s' "$CUR" | awk -F. '{n=$NF; w=length(n); $NF=sprintf("%0" w "d", n+1)} 1' OFS=.)
  read -r -p "Version [$SUGGEST]: " VERSION
  VERSION="${VERSION:-$SUGGEST}"
fi

[ -n "$APK_SRC" ] && [ -n "$VERSION" ] || die "usage: $0 [<path-to-apk> <version> [-y]]"
[ -f "$APK_SRC" ] || die "file not found: $APK_SRC"
[[ "$VERSION" =~ ^[0-9]+(\.[0-9]+){1,2}$ ]] || die "version must look like 1.1 or 1.1.2, got: $VERSION"

[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "switch to the main branch first (you are on $(git rev-parse --abbrev-ref HEAD))"
# Only script.js is committed, so changes under downloads/ (old APKs) do not matter.
[ -z "$(git status --porcelain -- . ':!downloads')" ] || die "you have uncommitted changes outside downloads/; commit or stash them first"
git pull --ff-only -q origin main || die "could not update main from GitHub"
[ -d api/node_modules ] || die "run 'npm install' in api/ first"

# Make sure it really is an APK and not a wrong file (a zip whose directory lists AndroidManifest.xml).
command -v node >/dev/null || die "node is needed to validate the APK"
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
process.exit(read(cdOffset, cdSize).includes("AndroidManifest.xml") ? 0 : 1);
' "$APK_SRC" || die "not a valid APK (bad zip or no AndroidManifest.xml)"

SIZE_BYTES=$(wc -c < "$APK_SRC" | tr -d ' ')
SIZE_MB=$(( SIZE_BYTES / 1048576 ))

OLD_VERSION=$(sed -n "s/^const APK_VERSION = '\(.*\)';/\1/p" script.js)
[ -n "$OLD_VERSION" ] || die "could not find APK_VERSION in script.js"

if command -v sha256sum >/dev/null; then SHA=$(sha256sum "$APK_SRC" | cut -d' ' -f1); else SHA=$(shasum -a 256 "$APK_SRC" | cut -d' ' -f1); fi

# Dry run first: checks R2 credentials, Supabase and that the version is new, without uploading.
ABS_APK="$(cd "$(dirname "$APK_SRC")" && pwd)/$(basename "$APK_SRC")"
(cd api && npm run --silent release -- "$ABS_APK" "$VERSION" --dry-run) || die "pre-flight check failed (see above)"

echo
echo "Publishing:  $OLD_VERSION -> $VERSION"
echo "APK:         $APK_SRC (${SIZE_MB} MB)"
echo "SHA-256:     $SHA"
echo
echo "Reminder: the APK's Android version code must be higher than the last build,"
echo "and it must be signed with the same keystore, or players cannot update in place."
echo
if [ "$ASSUME_YES" != "-y" ]; then
  read -r -p "Upload to R2, then commit and push to main? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { echo "Cancelled. Nothing changed."; exit 1; }
fi

# stdout of the release script is a single JSON line; progress goes to stderr.
RESULT=$(cd api && npm run --silent release -- "$ABS_APK" "$VERSION") || die "upload failed (see above); nothing was committed"
APK_URL=$(printf '%s' "$RESULT" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).url")
[ -n "$APK_URL" ] || die "could not read the APK URL from the release script"

sed -i.bak \
  -e "s|^const APK_PATH = .*;|const APK_PATH = '$APK_URL';|" \
  -e "s|^const APK_VERSION = '.*';|const APK_VERSION = '$VERSION';|" \
  -e "s|^const APK_SIZE_MB = .*;|const APK_SIZE_MB = $SIZE_MB;|" script.js && rm -f script.js.bak
grep -q "const APK_VERSION = '$VERSION';" script.js || die "uploaded, but failed to update script.js; set APK_PATH=$APK_URL by hand"

echo "$APK_SRC" > "$SAVED_FILE"
git add script.js
git commit -q -m "Release The Fatty v$VERSION" -m "SHA-256: $SHA"
git push -q origin main

echo
echo "Done. Pages redeploys in 1-2 minutes."
REPO_URL=$(git remote get-url origin | sed -e 's|\.git$||' -e 's|^git@github\.com:|https://github.com/|')
echo "Progress: $REPO_URL/actions"
