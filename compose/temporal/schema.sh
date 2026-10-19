#!/bin/sh
set -eu
schema=/etc/temporal/schema/postgresql/v12
for db in temporal temporal_visibility; do
  tool="temporal-sql-tool --plugin postgres12 --ep pg -p 5432 -u postgres --pw postgres --db $db"
  dir=$schema/temporal
  [ "$db" = temporal_visibility ] && dir=$schema/visibility
  $tool create-database
  $tool setup-schema -v 0.0
  $tool update-schema -d "$dir/versioned"
done
