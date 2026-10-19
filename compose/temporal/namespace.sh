#!/bin/sh
set -eu
until temporal operator cluster health --address temporal:7233 >/dev/null 2>&1; do sleep 1; done
temporal operator namespace describe --namespace bench --address temporal:7233 >/dev/null 2>&1 ||
  temporal operator namespace create --namespace bench --retention 72h --address temporal:7233
until temporal workflow list --namespace bench --address temporal:7233 >/dev/null 2>&1; do sleep 1; done
