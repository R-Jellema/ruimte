#!/bin/sh
set -u

# Uploads the archive's dSYMs so crash reports read as symbols. Only for an archive and only with the
# SENTRY_AUTH_TOKEN secret of the workflow; a failure here never fails the build.
if [ "${CI_XCODEBUILD_ACTION:-}" != "archive" ] || [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then
    exit 0
fi
dsyms="${CI_ARCHIVE_PATH:-}/dSYMs"
if [ ! -d "$dsyms" ]; then
    echo "No dSYMs in the archive, so none were uploaded."
    exit 0
fi
export HOMEBREW_NO_AUTO_UPDATE=1
if ! command -v sentry-cli >/dev/null 2>&1; then
    brew install getsentry/tools/sentry-cli || {
        echo "sentry-cli could not be installed, so no dSYMs were uploaded."
        exit 0
    }
fi
SENTRY_URL=https://de.sentry.io/ sentry-cli debug-files upload --org ruimte --project ios "$dsyms" ||
    echo "The dSYM upload failed; the build goes on without it."
exit 0
