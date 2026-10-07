#!/usr/bin/env bash
# Dumps pod status, events and logs of a helm release to aid debugging when a deploy fails.
# Used by dumpPodLogsOnFailure() in misc.jsonnet; runs in the helm-action image, which ships
# gcloud, kubectl and the gke-gcloud-auth-plugin.
#
# This lives in a file (shipped with the lib tarball as .github/jsonnet/scripts/) instead of
# inline in the generated workflow: inlining it per job pushed large workflow files over
# GitHub's 512 KB workflow file size limit, which makes the workflow silently not run.
#
# Expected environment:
#   CLUSTER_SA_JSON  - service account json with access to the cluster (same one used by the helm deploy)
#   CLUSTER_PROJECT  - gcp project of the cluster
#   CLUSTER_ZONE     - zone/region of the cluster
#   CLUSTER_NAME     - name of the cluster
#   RELEASE          - helm release name; pods are selected with the app=<release> label
#   NAMESPACE        - kubernetes namespace of the release

# Best-effort debugging: never abort halfway, and never fail the step on partial output.
set -uo pipefail

echo "::group::authenticate to cluster ${CLUSTER_NAME}"
printf '%s' "${CLUSTER_SA_JSON}" > /tmp/cluster-sa.json
account=$(jq -r .client_email /tmp/cluster-sa.json)
gcloud auth activate-service-account "${account}" --key-file=/tmp/cluster-sa.json || exit 0
gcloud container clusters get-credentials "${CLUSTER_NAME}" --zone "${CLUSTER_ZONE}" --project "${CLUSTER_PROJECT}" || exit 0
rm -f /tmp/cluster-sa.json
echo "::endgroup::"

selector="app=${RELEASE}"
pods=$(kubectl get pods -n "${NAMESPACE}" -l "${selector}" -o name)

if [ -z "${pods}" ]; then
  echo "No pods found for selector '${selector}' in namespace '${NAMESPACE}'; nothing to debug."
  exit 0
fi

echo "::group::pod status (${selector})"
kubectl get pods -n "${NAMESPACE}" -l "${selector}" -o wide
echo "::endgroup::"

for pod in ${pods}; do
  echo "::group::describe ${pod}"
  kubectl describe -n "${NAMESPACE}" "${pod}"
  echo "::endgroup::"

  echo "::group::logs ${pod}"
  kubectl logs -n "${NAMESPACE}" "${pod}" --all-containers --prefix --tail=200 || echo "(no logs available)"
  echo "::endgroup::"

  echo "::group::previous logs ${pod} (restarted containers)"
  kubectl logs -n "${NAMESPACE}" "${pod}" --all-containers --prefix --tail=200 --previous 2>/dev/null || echo "(no previous logs)"
  echo "::endgroup::"
done

exit 0
