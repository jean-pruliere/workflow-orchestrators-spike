#!/bin/sh
set -u
for rate in ${RATES:-50 500}; do
  for round in 1 2 3; do
    engines="temporal restate dbos"
    [ "$round" = 1 ] && engines="$engines naive none"
    for engine in $(printf '%s\n' $engines | sort -R); do
      scripts/perf.sh "$engine" "$rate" "${LOAD_S:-180}"
    done
  done
done
