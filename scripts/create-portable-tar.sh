#!/usr/bin/env bash

set -euo pipefail

if (( $# < 2 )); then
  echo "usage: $0 <archive.tar.gz> <tar input arguments...>" >&2
  exit 2
fi

ARCHIVE_PATH="$1"
shift

# COPYFILE_DISABLE prevents AppleDouble files while --no-xattrs prevents
# libarchive from encoding macOS extended attributes in PAX headers. Linux
# tar otherwise warns about LIBARCHIVE.xattr.* while extracting the archive.
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$ARCHIVE_PATH" "$@"
