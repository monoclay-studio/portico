#!/usr/bin/env bash
# Minimal stand-in for the aws CLI, enough for infra/ci/deploy-cell.sh. State lives in $FAKE_DIR:
#   config.json                 deploy-config parameter value
#   ecr/<repo>/<tag>            digest a tag points to ("/" in repository names stored as "__")
#   manifests/<hex>             raw manifest bytes of an image digest
#   svc/<service>               PRIMARY deployment id; every forced deployment logs the release digest it resolves
#   calls.log                   every call, one per line (the tests assert on it)
# Knobs: FAKE_ROLLOUT_<service> (rolloutState for that service, default COMPLETED), FAKE_HOST_STATUS (SSM status).
# Like ECR: SHA tags are immutable, only `release` may move; an unhandled call fails loudly.
set -euo pipefail
D="${FAKE_DIR:?}"
echo "$*" >>"$D/calls.log"
arg() { local want="$1"; shift; while [ $# -gt 0 ]; do [ "$1" = "$want" ] && { echo "$2"; return; }; shift; done; }
key() { echo "${1//\//__}"; }
svc="$1" op="$2"; shift 2
case "$svc $op" in
  "ssm get-parameter") cat "$D/config.json" ;;
  "ecr get-login-password") echo "fake-token" ;;
  "ecr describe-images")
    r="$(key "$(arg --repository-name "$@")")"; id="$(arg --image-ids "$@")"; t="${id#imageTag=}"
    if [ -f "$D/ecr/$r/$t" ]; then cat "$D/ecr/$r/$t"; else echo "ImageNotFoundException" >&2; exit 254; fi ;;
  "ecr batch-get-image")
    id="$(arg --image-ids "$@")"; d="${id#imageDigest=}"; q="$(arg --query "$@")"
    [ -f "$D/manifests/${d#sha256:}" ] || { echo "ImageNotFound" >&2; exit 254; }
    if [[ "$q" == *MediaType* ]]; then echo "application/vnd.oci.image.index.v1+json"; else cat "$D/manifests/${d#sha256:}"; fi ;;
  "ecr put-image")
    r="$(key "$(arg --repository-name "$@")")"; t="$(arg --image-tag "$@")"; m="$(arg --image-manifest "$@")"
    d="sha256:$(printf '%s' "$m" | sha256sum | cut -d' ' -f1)"
    if [ "$t" != release ] && [ -f "$D/ecr/$r/$t" ]; then echo "ImageTagAlreadyExistsException" >&2; exit 254; fi
    mkdir -p "$D/ecr/$r"; echo "$d" >"$D/ecr/$r/$t"; echo "$d" ;;
  "ecs describe-services")
    s="$(arg --services "$@")"; q="$(arg --query "$@")"
    v="FAKE_ROLLOUT_$s"
    if [[ "$q" == *rolloutState* ]]; then echo "${!v:-COMPLETED}"; else cat "$D/svc/$s" 2>/dev/null || echo "ecs-svc/0"; fi ;;
  "ecs update-service")
    s="$(arg --service "$@")"
    n=$(( $(cat "$D/svc/$s.n" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$D/svc/$s.n"; echo "ecs-svc/$n" >"$D/svc/$s"
    repo="$(jq -r ".repositories[\"$s\"]" "$D/config.json")"; r="$(key "${repo#*/}")"
    echo "deployed $s $(cat "$D/ecr/$r/release" 2>/dev/null || echo none)" >>"$D/calls.log"
    echo "$s" ;;
  "ecs wait") exit 0 ;;
  "s3 sync" | "s3 cp" | "cloudfront create-invalidation") exit 0 ;;
  "ssm send-command") echo "cmd-1" ;;
  "ssm get-command-invocation") echo "${FAKE_HOST_STATUS:-Success}" ;;
  *) echo "fake-aws: unhandled $svc $op (the deploy role may not have this permission either)" >&2; exit 1 ;;
esac
