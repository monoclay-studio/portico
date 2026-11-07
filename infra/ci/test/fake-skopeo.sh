#!/usr/bin/env bash
# Stand-in for skopeo: an "archive" X is modelled by X.raw (its top-level index manifest bytes). `inspect --raw`
# prints them; `copy --all --preserve-digests` stores them under the tag with digest = sha256(raw), like ECR does for
# an index. FAKE_PUSH_DIGEST simulates a registry that rewrites the image (digest not preserved).
set -euo pipefail
D="${FAKE_DIR:?}"
echo "skopeo $*" >>"$D/calls.log"
case "$1" in
  login) cat >/dev/null ;;
  inspect) a="${*: -1}"; cat "${a#oci-archive:}.raw" ;;
  copy)
    [[ " $* " == *" --all "* ]] || { echo "fake-skopeo: copy without --all would push one platform only" >&2; exit 1; }
    src="${*: -2:1}"; dst="${*: -1}"; ref="${dst#docker://*/}"; repo="${ref%%:*}"; tag="${ref##*:}"
    raw="$(cat "${src#oci-archive:}.raw")"; d="sha256:$(printf '%s' "$raw" | sha256sum | cut -d' ' -f1)"
    mkdir -p "$D/ecr/${repo//\//__}" "$D/manifests"; printf '%s' "$raw" >"$D/manifests/${d#sha256:}"
    echo "${FAKE_PUSH_DIGEST:-$d}" >"$D/ecr/${repo//\//__}/$tag" ;;
  *) echo "fake-skopeo: unhandled $1" >&2; exit 1 ;;
esac
