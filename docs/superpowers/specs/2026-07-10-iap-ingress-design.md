# Google IAP at the Ingress — Design

Date: 2026-07-10
Status: Approved

## Goal

Put a Google identity layer (IAP) in front of `optio.gynzy.dev` at the load
balancer, before any traffic reaches optio pods. Optio's own application login
stays as-is (it will be disabled later, separately).

## Context

Production runs the chart's GKE-native ingress (GCLB) with paths `/*` → web,
`/api/*` + `/ws/*` → api, a Cloud Armor policy, and a Google-managed
certificate. The chart already renders `BackendConfig` resources for both
services, and `auth.google.clientId` / `auth.google.clientSecret` values
already exist (they feed optio's own Google login via the `optio-config`
secret).

## Decisions

- **Mechanism**: Google Identity-Aware Proxy enabled per backend service via
  the existing `BackendConfig` templates. No new proxy components.
- **Coverage**: IAP on **both** web and api backends. External webhook
  callers (`/api/webhooks/*`, `/api/hooks/*`, Slack events) are knowingly
  blocked — no bypass backend.
- **App auth**: unchanged. IAP is a pure extra gate.
- **OAuth client**: reuse the existing Google OAuth client from
  `auth.google.*` values. IAP requires a secret with keys exactly
  `client_id` / `client_secret`, so the chart renders a small dedicated
  secret from those same values.

## Chart changes

1. `values.yaml` — new setting:

   ```yaml
   ingress:
     gke:
       iap:
         enabled: false
   ```

2. New template `templates/iap-secret.yaml` — when
   `ingress.enabled && ingress.gke.enabled && ingress.gke.iap.enabled`,
   render:

   ```yaml
   apiVersion: v1
   kind: Secret
   metadata:
     name: {{ .Release.Name }}-iap-oauth
   stringData:
     client_id: {{ .Values.auth.google.clientId }}
     client_secret: {{ .Values.auth.google.clientSecret }}
   ```

   Fail the render (`fail`) if IAP is enabled but `auth.google.clientId`
   is empty.

3. `templates/backend-config.yaml` — when IAP is enabled, both
   BackendConfigs gain:

   ```yaml
   iap:
     enabled: true
     oauthclientCredentials:
       secretName: {{ .Release.Name }}-iap-oauth
   ```

4. `values.production.yaml` — document the `iap` block (left disabled), plus
   the manual GCP steps.

## Manual GCP steps (one-time, outside helm)

1. Add redirect URI
   `https://iap.googleapis.com/v1/oauth/clientIds/<CLIENT_ID>:handleRedirect`
   to the existing Google OAuth client.
2. Grant `roles/iap.httpsResourceAccessor` to the gynzy.com domain (or a
   Google group) on the IAP-protected backend services.

## Behavior notes

- GCLB health checks bypass IAP — `/api/health` checks keep working.
- WebSockets (`/ws/*`) work through IAP via the browser session cookie.
- Cloud Armor policy coexists with IAP on the same backend services.
- Agent pods talk to the API via in-cluster service DNS, bypassing the
  ingress — unaffected.
- Rollback: `helm upgrade` with `ingress.gke.iap.enabled=false`.

## Testing

- `helm template` render checks (no unit-test framework in this chart): IAP
  block present on both BackendConfigs when enabled, absent when disabled,
  secret rendered with correct keys, render failure when google client id
  missing.
- `helm lint` passes.
- Post-deploy verification: anonymous curl to `https://optio.gynzy.dev`
  returns a Google sign-in redirect; authenticated gynzy browser session
  reaches optio; task log streaming over WS still works.
