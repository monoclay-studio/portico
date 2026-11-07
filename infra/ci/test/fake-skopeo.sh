#!/usr/bin/env bash
# Stand-in for skopeo: `inspect` returns the digest written next to the archive (<archive>.digest); `copy` records
# that digest as the repository's image (FAKE_PUSH_DIGEST overrides it to simulate a registry rewriting the image).
set -euo pipefail
D="${FAKE_DIR:?}"
echo "skopeo $*" >>"$D/calls.log"
case "$1" in
  login) cat >/dev/null ;;
  inspect) a="${@: -1}"; cat "${a#oci-archive:}.digest" ;;
  copy)
    src="${@: -2:1}"; dst="${@: -1}"
    repo="${dst#docker://*/}"; repo="${repo%%:*}"
    mkdir -p "$D/ecr"; echo "${FAKE_PUSH_DIGEST:-$(cat "${src#oci-archive:}.digest")}" >"$D/ecr/$repo" ;;
  *) echo "fake-skopeo: unhandled $1" >&2; exit 1 ;;
esac
