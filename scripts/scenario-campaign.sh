#!/bin/sh
set -u
for engine in ${ENGINES:-temporal restate dbos}; do
  for scenario in typedError saga timer retry; do
    scripts/scenario.sh "$engine" "$scenario"
  done
  case "$engine" in
    restate) variants="blue-green in-place" ;;
    *) variants="patched unversioned" ;;
  esac
  for variant in $variants; do
    scripts/scenario.sh "$engine" versioned "$variant"
  done
  scripts/scenario.sh "$engine" sealed default
  scripts/scenario.sh "$engine" sealed encrypted
done
