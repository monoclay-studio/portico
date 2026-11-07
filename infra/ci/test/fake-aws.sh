#!/usr/bin/env bash
# Minimal stand-in for the aws CLI, enough for infra/ci/deploy-cell.sh. State lives in $FAKE_DIR:
#   config.json          deploy-config parameter value
#   current/<service>    task definition the service runs
#   calls.log            every call, one per line (the test asserts on it)
#   ecr/<repository>     digest stored under the tag being deployed (written by fake-skopeo.sh)
# Knobs: FAKE_MIGRATE_EXIT (exit code of the migrate task, default 0), FAKE_ROLLOUT (rolloutState, default
# COMPLETED), FAKE_HOST_STATUS (SSM command status, default Success).
set -euo pipefail
D="${FAKE_DIR:?}"
echo "$*" >>"$D/calls.log"
arg() { local want="$1"; shift; while [ $# -gt 0 ]; do [ "$1" = "$want" ] && { echo "$2"; return; }; shift; done; }
svc="$1" op="$2"; shift 2
case "$svc $op" in
  "ssm get-parameter") cat "$D/config.json" ;;
  "ecs describe-services")
    s="$(arg --services "$@")"
    q="$(arg --query "$@")"
    case "$q" in
      *rolloutState*) echo "${FAKE_ROLLOUT:-COMPLETED}" ;;
      *) cat "$D/current/$s" ;;
    esac ;;
  "ecs describe-task-definition")
    fam="$(arg --task-definition "$@")"
    jq -n --arg fam "$fam" '{family: $fam, taskDefinitionArn: ("arn:td/" + $fam + ":1"), revision: 1, status: "ACTIVE",
      registeredAt: "x", compatibilities: ["FARGATE"], requiresAttributes: [],
      containerDefinitions: [{name: ($fam | sub(".*-"; "")), image: "repo/old:0000000"}]}' ;;
  "ecs register-task-definition")
    f="$(arg --cli-input-json "$@")"; f="${f#file://}"
    jq -e 'has("taskDefinitionArn") | not' "$f" >/dev/null || { echo "read-only field left in task definition" >&2; exit 1; }
    fam="$(jq -r .family "$f")"; img="$(jq -r '.containerDefinitions[0].image' "$f")"
    echo "register $fam $img" >>"$D/calls.log"
    echo "arn:td/$fam:2" ;;
  "ecs run-task")
    td="$(arg --task-definition "$@")"; ov="$(arg --overrides "$@")"
    n=$(( $(cat "$D/tasks" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$D/tasks"
    kind=other; [[ "$td" == *migrate* ]] && kind=migrate; [[ "$ov" == *grants* ]] && kind=grants
    echo "$kind" >"$D/task-$n"
    echo "arn:task/$n" ;;
  "ecs wait") exit 0 ;;
  "ecs describe-tasks")
    t="$(arg --tasks "$@")"; kind="$(cat "$D/task-${t##*/}")"
    q="$(arg --query "$@")"
    if [[ "$q" == *exitCode* ]]; then [ "$kind" = migrate ] && echo "${FAKE_MIGRATE_EXIT:-0}" || echo 0; else echo "Essential container in task exited"; fi ;;
  "ecs update-service")
    s="$(arg --service "$@")"; td="$(arg --task-definition "$@")"
    echo "$td" >"$D/current/$s"; echo "$s" ;;
  "s3 sync" | "s3 cp" | "cloudfront create-invalidation") exit 0 ;;
  "ecr get-login-password") echo "fake-token" ;;
  "ecr describe-images")
    r="$(arg --repository-name "$@")"
    if [ -f "$D/ecr/$r" ]; then cat "$D/ecr/$r"; else echo "ImageNotFoundException" >&2; exit 254; fi ;;
  "ssm send-command") echo "cmd-1" ;;
  "ssm get-command-invocation") echo "${FAKE_HOST_STATUS:-Success}" ;;
  *) echo "fake-aws: unhandled $svc $op" >&2; exit 1 ;;
esac
