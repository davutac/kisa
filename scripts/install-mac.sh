#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
APPLICATIONS_DIRECTORY="/Applications"
INSTALLED_APP="$APPLICATIONS_DIRECTORY/Kisa.app"

if [ "$(uname -s)" != "Darwin" ]; then
  printf 'install-mac: this script can only run on macOS.\n' >&2
  exit 1
fi

case "$(uname -m)" in
  arm64)
    BUILD_DIRECTORY="mac-arm64"
    ;;
  x86_64)
    BUILD_DIRECTORY="mac"
    ;;
  *)
    printf 'install-mac: unsupported Mac architecture: %s.\n' "$(uname -m)" >&2
    exit 1
    ;;
esac

BUILT_APP="$REPOSITORY_ROOT/apps/desktop/dist/$BUILD_DIRECTORY/Kisa.app"

printf 'Building Kisa for macOS...\n'
cd "$REPOSITORY_ROOT"
pnpm build:mac

if [ ! -d "$BUILT_APP" ]; then
  printf 'install-mac: expected app bundle at %s.\n' "$BUILT_APP" >&2
  exit 1
fi

run_in_applications() {
  if [ -w "$APPLICATIONS_DIRECTORY" ]; then
    "$@"
  else
    /usr/bin/sudo "$@"
  fi
}

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
run_in_applications /bin/rm -rf "$INSTALLED_APP"
run_in_applications /bin/mv "$STAGED_APP" "$INSTALLED_APP"

printf 'Installed %s successfully.\n' "$INSTALLED_APP"
