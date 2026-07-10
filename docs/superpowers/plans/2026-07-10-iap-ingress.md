# Google IAP at the GKE Ingress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Google Identity-Aware Proxy on the existing GKE ingress so every request to optio.gynzy.dev must carry a gynzy Google identity before reaching optio pods.

**Architecture:** A single new helm value `ingress.gke.iap.enabled` gates two changes: a small dedicated secret (`<release>-iap-oauth`, keys `client_id`/`client_secret` as IAP requires) rendered from the existing `auth.google.*` values, and an `iap` block on both existing BackendConfigs. No new runtime components; optio's own login is untouched.

**Tech Stack:** Helm chart (`helm/optio/`), GKE BackendConfig CRD, Google IAP.

Spec: `docs/superpowers/specs/2026-07-10-iap-ingress-design.md`

## Global Constraints

- IAP covers **both** web and api backends. No bypass for `/api/webhooks/*`, `/api/hooks/*`, or Slack — external webhook callers are knowingly blocked.
- The IAP secret's keys must be exactly `client_id` and `client_secret` (GKE requirement).
- Guard all template accesses with `and` chains so old values files without the `iap` key still render (nil-safe).
- No app code changes. No GitHub workflow changes.

---

### Task 1: Chart changes — IAP value, secret template, BackendConfig blocks

**Files:**

- Modify: `helm/optio/values.yaml` (ingress.gke block, ~line 397)
- Create: `helm/optio/templates/iap-secret.yaml`
- Modify: `helm/optio/templates/backend-config.yaml`

**Interfaces:**

- Consumes: existing values `auth.google.clientId`, `auth.google.clientSecret`, `ingress.gke.enabled`.
- Produces: value `ingress.gke.iap.enabled` (bool, default false); secret `{{ .Release.Name }}-iap-oauth`; `iap` block on both BackendConfigs referencing that secret.

- [ ] **Step 1: Capture the failing render check**

Run (from repo root):

```bash
helm template optio helm/optio \
  --set encryption.key=b8f2a1d94c7e3f605a2b9d8c1e4f7a0312d5c8b6e9f2a4d7c0b3e6f9a2d5c8b1 \
  --set publicUrl=https://optio.gynzy.dev \
  --set auth.google.clientId=test-id \
  --set auth.google.clientSecret=test-secret \
  --set ingress.enabled=true \
  --set ingress.gke.enabled=true \
  --set ingress.gke.iap.enabled=true \
  | grep -A4 "iap:"
```

Expected: FAIL — `--set ingress.gke.iap.enabled=true` renders nothing (no `iap:` output; grep exits 1).

- [ ] **Step 2: Add the value to `helm/optio/values.yaml`**

In the `ingress.gke` block (after `cloudArmorPolicy: ""`), add:

```yaml
# Google Identity-Aware Proxy. When enabled, every request through the
# GKE ingress must carry a Google identity before reaching optio pods.
# Reuses the OAuth client from auth.google.clientId/clientSecret.
# NOTE: blocks external webhook callers (/api/webhooks, /api/hooks, Slack).
# One-time GCP setup:
#   1. Add redirect URI to the OAuth client:
#      https://iap.googleapis.com/v1/oauth/clientIds/<CLIENT_ID>:handleRedirect
#   2. Grant access:
#      gcloud iap web add-iam-policy-binding \
#        --member=domain:<your-domain> --role=roles/iap.httpsResourceAccessor
iap:
  enabled: false
```

- [ ] **Step 3: Create `helm/optio/templates/iap-secret.yaml`**

```yaml
{{- if and .Values.ingress.enabled .Values.ingress.gke .Values.ingress.gke.enabled .Values.ingress.gke.iap .Values.ingress.gke.iap.enabled }}
{{- if or (not .Values.auth.google.clientId) (not .Values.auth.google.clientSecret) }}
{{- fail "ingress.gke.iap.enabled requires auth.google.clientId and auth.google.clientSecret" }}
{{- end }}
apiVersion: v1
kind: Secret
metadata:
  name: {{ .Release.Name }}-iap-oauth
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "optio.labels" . | nindent 4 }}
type: Opaque
stringData:
  client_id: {{ .Values.auth.google.clientId | quote }}
  client_secret: {{ .Values.auth.google.clientSecret | quote }}
{{- end }}
```

- [ ] **Step 4: Add the `iap` block to both BackendConfigs in `helm/optio/templates/backend-config.yaml`**

Insert this block into **both** BackendConfig specs — in the api config directly under `timeoutSec: 3600`, and in the web config directly under `spec:`:

```yaml
  {{- if and .Values.ingress.gke.iap .Values.ingress.gke.iap.enabled }}
  iap:
    enabled: true
    oauthclientCredentials:
      secretName: {{ .Release.Name }}-iap-oauth
  {{- end }}
```

- [ ] **Step 5: Verify enabled render**

Re-run the Step 1 command. Expected: two `iap:` blocks, each with `enabled: true` and `secretName: optio-iap-oauth`. Also verify the secret:

```bash
helm template optio helm/optio \
  --set encryption.key=b8f2a1d94c7e3f605a2b9d8c1e4f7a0312d5c8b6e9f2a4d7c0b3e6f9a2d5c8b1 \
  --set publicUrl=https://optio.gynzy.dev \
  --set auth.google.clientId=test-id \
  --set auth.google.clientSecret=test-secret \
  --set ingress.enabled=true \
  --set ingress.gke.enabled=true \
  --set ingress.gke.iap.enabled=true \
  --show-only templates/iap-secret.yaml
```

Expected: secret `optio-iap-oauth` with `client_id: "test-id"` and `client_secret: "test-secret"`.

- [ ] **Step 6: Verify disabled + guard renders**

```bash
# Disabled (default): no iap anywhere
helm template optio helm/optio \
  --set encryption.key=b8f2a1d94c7e3f605a2b9d8c1e4f7a0312d5c8b6e9f2a4d7c0b3e6f9a2d5c8b1 \
  --set publicUrl=https://optio.gynzy.dev \
  --set auth.google.clientId=test-id \
  --set auth.google.clientSecret=test-secret \
  --set ingress.enabled=true \
  --set ingress.gke.enabled=true \
  | grep "iap" ; echo "exit=$?"

# IAP enabled without google creds: must fail with the message above
helm template optio helm/optio \
  --set encryption.key=b8f2a1d94c7e3f605a2b9d8c1e4f7a0312d5c8b6e9f2a4d7c0b3e6f9a2d5c8b1 \
  --set publicUrl=https://optio.gynzy.dev \
  --set auth.github.clientId=test-id \
  --set auth.github.clientSecret=test-secret \
  --set ingress.enabled=true \
  --set ingress.gke.enabled=true \
  --set ingress.gke.iap.enabled=true
```

Expected: first command prints nothing / `exit=1`; second fails with `ingress.gke.iap.enabled requires auth.google.clientId and auth.google.clientSecret`.

- [ ] **Step 7: Lint**

```bash
helm lint helm/optio --set encryption.key=b8f2a1d94c7e3f605a2b9d8c1e4f7a0312d5c8b6e9f2a4d7c0b3e6f9a2d5c8b1
```

Expected: `1 chart(s) linted, 0 chart(s) failed`.

- [ ] **Step 8: Commit**

```bash
git add helm/optio/values.yaml helm/optio/templates/iap-secret.yaml helm/optio/templates/backend-config.yaml
git commit -m "feat: support Google IAP on the GKE ingress via BackendConfig"
```

---

### Task 2: Document in values.production.yaml

**Files:**

- Modify: `helm/optio/values.production.yaml` (ingress block, ~line 94)

**Interfaces:**

- Consumes: `ingress.gke.iap.enabled` from Task 1.
- Produces: documentation only.

- [ ] **Step 1: Add the IAP block (disabled) with setup notes**

In `values.production.yaml`, inside `ingress.gke` after `cloudArmorPolicy: optio`, add:

```yaml
# Google IAP: gate the whole site behind Google sign-in at the load
# balancer. Requires auth.google.clientId/clientSecret. Blocks external
# webhook callers. See ingress.gke.iap comments in values.yaml for the
# one-time GCP setup (OAuth redirect URI + IAM grant).
iap:
  enabled: false
```

- [ ] **Step 2: Verify production values still render**

```bash
helm template optio helm/optio -f helm/optio/values.production.yaml \
  --set encryption.key=b8f2a1d94c7e3f605a2b9d8c1e4f7a0312d5c8b6e9f2a4d7c0b3e6f9a2d5c8b1 \
  --set publicUrl=https://optio.example.com \
  --set auth.google.clientId=test-id \
  --set auth.google.clientSecret=test-secret \
  --set externalDatabase.url=postgres://u:p@h:5432/optio \
  --set externalRedis.url=redis://h:6379 > /dev/null && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit (include spec + plan docs)**

```bash
git add helm/optio/values.production.yaml docs/superpowers/specs/2026-07-10-iap-ingress-design.md docs/superpowers/plans/2026-07-10-iap-ingress.md
git commit -m "docs: document IAP ingress option and design"
```

---

### Task 3: Production rollout (interactive — run with the operator, not a subagent)

**Files:** none (cluster + GCP operations). Context: `gke_gh-runners_europe-west4_gh-runners-2023`, namespace `optio`, GCP project `gh-runners`.

- [ ] **Step 1: Get the OAuth client id from the cluster**

```bash
kubectl --context gke_gh-runners_europe-west4_gh-runners-2023 -n optio \
  get secret optio-config -o jsonpath='{.data.GOOGLE_OAUTH_CLIENT_ID}' | base64 -d
```

- [ ] **Step 2: Add the IAP redirect URI to that OAuth client**

In GCP Console (project `gh-runners`) → APIs & Services → Credentials → the OAuth client from Step 1 → add authorized redirect URI:

```
https://iap.googleapis.com/v1/oauth/clientIds/<CLIENT_ID>:handleRedirect
```

- [ ] **Step 3: Grant IAP access to gynzy.com**

```bash
gcloud iap web add-iam-policy-binding --project=gh-runners \
  --member=domain:gynzy.com --role=roles/iap.httpsResourceAccessor
```

- [ ] **Step 4: Deploy**

Upgrade the release with IAP on, using whatever values flow prod normally uses, e.g.:

```bash
helm upgrade optio helm/optio -n optio --reuse-values \
  --kube-context gke_gh-runners_europe-west4_gh-runners-2023 \
  --set ingress.gke.iap.enabled=true
```

- [ ] **Step 5: Verify**

```bash
# Backend configs picked up IAP
kubectl --context gke_gh-runners_europe-west4_gh-runners-2023 -n optio \
  get backendconfig -o yaml | grep -B2 -A3 "iap:"

# Anonymous request redirects to Google sign-in (allow a few minutes for LB propagation)
curl -sI https://optio.gynzy.dev | head -5
```

Expected: both BackendConfigs show `iap.enabled: true`; curl returns `302` to `accounts.google.com`. Then in a browser with a gynzy account: sign in through Google, confirm optio loads and a running task's log stream (WebSocket) works.

- [ ] **Step 6: Rollback plan (only if broken)**

```bash
helm upgrade optio helm/optio -n optio --reuse-values \
  --kube-context gke_gh-runners_europe-west4_gh-runners-2023 \
  --set ingress.gke.iap.enabled=false
```
