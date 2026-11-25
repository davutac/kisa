#!/bin/sh
#
# Builds a signed production Kisa for this Mac and installs it in /Applications.
#
#   scripts/install-mac.sh              build, sign, verify, install
#   scripts/install-mac.sh --notarize   also require Apple notarization
#
# Signing uses the Developer ID Application certificate in the login keychain.
# Notarization runs whenever electron-builder finds Apple credentials in the
# environment: APPLE_KEYCHAIN_PROFILE (a `xcrun notarytool store-credentials`
# profile), or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or
# APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER.
#
# Only the app bundle is replaced. Mail data lives in Kisa's userData folder and
# is never touched.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
APPLICATIONS_DIRECTORY="/Applications"
INSTALLED_APP="$APPLICATIONS_DIRECTORY/Kisa.app"
BUNDLE_ID="com.kisa.app"
QUIT_TIMEOUT_SECONDS=30

fail() {
  printf 'install-mac: %s\n' "$1" >&2
  exit 1
}

REQUIRE_NOTARIZATION=0
for argument in "$@"; do
  case "$argument" in
    --notarize) REQUIRE_NOTARIZATION=1 ;;
    -h | --help)
      sed -n '3,15p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) fail "unknown option: $argument (try --help)" ;;
  esac
done

[ "$(uname -s)" = "Darwin" ] || fail "this script can only run on macOS."

case "$(uname -m)" in
  arm64) BUILD_DIRECTORY="mac-arm64" ;;
  x86_64) BUILD_DIRECTORY="mac" ;;
  *) fail "unsupported Mac architecture: $(uname -m)." ;;
esac

DESKTOP_DIRECTORY="$REPOSITORY_ROOT/apps/desktop"
BUILD_OUTPUT="$DESKTOP_DIRECTORY/dist/$BUILD_DIRECTORY"
BUILT_APP="$BUILD_OUTPUT/Kisa.app"

# --- Preflight: fail before a multi-minute build, not after it. -------------

DEVELOPER_ID_IDENTITIES=$(/usr/bin/security find-identity -v -p codesigning |
  /usr/bin/grep '"Developer ID Application: ' || true)
if [ -z "$DEVELOPER_ID_IDENTITIES" ]; then
  fail "no valid \"Developer ID Application\" identity in the keychain.
See docs/releasing/macos-signing.md for how to create one."
fi

# electron-builder passes codesign the certificate's name, not its hash, so two
# valid certificates with the same name make every signature ambiguous.
DUPLICATE_IDENTITY_NAMES=$(printf '%s\n' "$DEVELOPER_ID_IDENTITIES" |
  /usr/bin/sed 's/^[^"]*"\(.*\)"$/\1/' | /usr/bin/sort | /usr/bin/uniq -d)
if [ -n "$DUPLICATE_IDENTITY_NAMES" ]; then
  fail "the keychain has several valid certificates named
\"$DUPLICATE_IDENTITY_NAMES\", so codesign cannot choose one.
Remove the one you no longer use (Keychain Access, or
\`security delete-certificate -Z <SHA-1>\`). The candidates are:
$DEVELOPER_ID_IDENTITIES"
fi

has_notarization_credentials() {
  [ -n "${APPLE_KEYCHAIN_PROFILE:-}" ] && return 0
  [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] &&
    [ -n "${APPLE_TEAM_ID:-}" ] && return 0
  [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_KEY_ID:-}" ] &&
    [ -n "${APPLE_API_ISSUER:-}" ] && return 0
  return 1
}

if has_notarization_credentials; then
  printf 'Notarization credentials found; the build will be notarized.\n'
elif [ "$REQUIRE_NOTARIZATION" -eq 1 ]; then
  fail "--notarize needs APPLE_KEYCHAIN_PROFILE, or APPLE_ID +
APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or APPLE_API_KEY +
APPLE_API_KEY_ID + APPLE_API_ISSUER."
else
  printf 'No notarization credentials; the build will be signed but not notarized.\n'
fi

# --- Build ------------------------------------------------------------------

# A stale bundle from an earlier build must never be mistaken for this one.
/bin/rm -rf "$BUILD_OUTPUT"

cd "$REPOSITORY_ROOT"
printf 'Building Kisa...\n'
bun run build
# electron-builder runs outside turbo so packaging and signing always happen
# fresh: turbo's cache key ignores the keychain and APPLE_* credentials.
printf 'Packaging and signing Kisa...\n'
bun run --cwd "$DESKTOP_DIRECTORY" build:mac --publish never

[ -d "$BUILT_APP" ] || fail "expected app bundle at $BUILT_APP."

# --- Verify -----------------------------------------------------------------

verify_signature() {
  app="$1"
  /usr/bin/codesign --verify --deep --strict "$app" ||
    fail "$app failed signature verification."

  details=$(/usr/bin/codesign --display --verbose=4 "$app" 2>&1)
  printf '%s\n' "$details" | /usr/bin/grep -q '^Authority=Developer ID Application: ' ||
    fail "$app is not signed with a Developer ID Application certificate."
  printf '%s\n' "$details" | /usr/bin/grep -q '^CodeDirectory .*(runtime)' ||
    fail "$app is not signed with the hardened runtime."
  printf '%s\n' "$details" | /usr/bin/grep -q "^Identifier=$BUNDLE_ID\$" ||
    fail "$app does not have the bundle identifier $BUNDLE_ID."
}

is_notarized() {
  /usr/bin/xcrun stapler validate -q "$1" >/dev/null 2>&1 &&
    /usr/sbin/spctl --assess --type execute "$1" >/dev/null 2>&1
}

verify_signature "$BUILT_APP"
SIGNED_BY=$(/usr/bin/codesign --display --verbose=2 "$BUILT_APP" 2>&1 |
  /usr/bin/sed -n 's/^Authority=\(Developer ID Application: .*\)$/\1/p')
printf 'Signed by %s.\n' "$SIGNED_BY"

NOTARIZED=0
if is_notarized "$BUILT_APP"; then
  NOTARIZED=1
  printf 'Notarization ticket is stapled and Gatekeeper accepts the app.\n'
elif [ "$REQUIRE_NOTARIZATION" -eq 1 ]; then
  fail "the build is not notarized; check the electron-builder output above."
fi

# --- Quit a running Kisa ----------------------------------------------------

kisa_is_running() {
  [ "$(/usr/bin/osascript -e "application id \"$BUNDLE_ID\" is running" 2>/dev/null)" = "true" ]
}

WAS_RUNNING=0
if kisa_is_running; then
  WAS_RUNNING=1
  printf 'Quitting Kisa...\n'
  /usr/bin/osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null
  waited=0
  while kisa_is_running; do
    [ "$waited" -lt "$QUIT_TIMEOUT_SECONDS" ] ||
      fail "Kisa did not quit within ${QUIT_TIMEOUT_SECONDS}s; quit it and run again."
    /bin/sleep 1
    waited=$((waited + 1))
  done
fi

# --- Install ----------------------------------------------------------------

run_in_applications() {
  if [ -w "$APPLICATIONS_DIRECTORY" ]; then
    "$@"
  else
    /usr/bin/sudo "$@"
  fi
}

# Stage beside the destination so the final swap is a same-volume rename.
STAGING_DIRECTORY=$(run_in_applications \
  /usr/bin/mktemp -d "$APPLICATIONS_DIRECTORY/.kisa-install.XXXXXX")
STAGED_APP="$STAGING_DIRECTORY/Kisa.app"

cleanup() {
  run_in_applications /bin/rm -rf "$STAGING_DIRECTORY"
}

trap cleanup EXIT
trap 'exit 1' HUP INT TERM

printf 'Installing Kisa in %s...\n' "$APPLICATIONS_DIRECTORY"
run_in_applications /usr/bin/ditto "$BUILT_APP" "$STAGED_APP"
verify_signature "$STAGED_APP"
run_in_applications /bin/rm -rf "$INSTALLED_APP"
run_in_applications /bin/mv "$STAGED_APP" "$INSTALLED_APP"

VERSION=$(/usr/bin/defaults read "$INSTALLED_APP/Contents/Info" CFBundleShortVersionString)
if [ "$NOTARIZED" -eq 1 ]; then
  printf 'Installed Kisa %s (signed and notarized) at %s.\n' "$VERSION" "$INSTALLED_APP"
else
  printf 'Installed Kisa %s (signed, not notarized) at %s.\n' "$VERSION" "$INSTALLED_APP"
fi

if [ "$WAS_RUNNING" -eq 1 ]; then
  printf 'Reopening Kisa...\n'
  /usr/bin/open "$INSTALLED_APP"
fi
