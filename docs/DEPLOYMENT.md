# VectorBea Proxy — Deployment Guide

> **Audience:** Engineers integrating the VectorBea Proxy sidecar into their own infrastructure.  
> **Proxy image:** `vectorbea/vectorbea-proxy:latest`  
> **Support:** support@vectorbea.io

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Docker Compose Quickstart](#docker-compose-quickstart) — Indie / Local
4. [Kubernetes Helm Chart](#kubernetes-helm-chart) — Enterprise
   - [Chart Scaffolding](#chart-scaffolding)
   - [Sidecar Deployment Template](#sidecar-deployment-template)
   - [Passing Secrets Securely](#passing-secrets-securely)
   - [Installing the Chart](#installing-the-chart)
5. [Environment Variable Reference](#environment-variable-reference)
6. [Health Checks](#health-checks)
7. [Troubleshooting](#troubleshooting)

---

## Overview

The VectorBea Proxy is a lightweight Kotlin sidecar that sits next to your application and intercepts outbound LLM calls. It:

- Resolves prompt templates from the VectorBea Hub at request time (no redeploy needed to update prompts).
- Streams audit events back to the Hub for latency tracking, token counting, and cost attribution.
- Handles retries, circuit-breaking, and back-pressure so your application code does not have to.

```
┌─────────────────────────────────────────┐
│              Your Pod / Host            │
│                                         │
│  ┌─────────────┐    HTTP localhost      │
│  │  Your App   │──────────────────────► │
│  │             │       :8080            │
│  └─────────────┘                        │
│                   ┌─────────────────┐   │
│                   │ VectorBea Proxy │   │
│                   │   (sidecar)     │──►│ VectorBea Hub (SaaS)
│                   └─────────────────┘   │
└─────────────────────────────────────────┘
```

Your application calls `http://localhost:8080` (Kubernetes) or `http://vectorbea-proxy:8080` (Docker Compose). The proxy enriches the request with the resolved prompt template, forwards it to the upstream LLM provider, and returns the response — all transparently.

---

## Prerequisites

| Requirement | Minimum version |
|---|---|
| Docker Engine | 24.x |
| Docker Compose | v2.x (`docker compose`, not `docker-compose`) |
| Kubernetes | 1.27+ |
| Helm | 3.12+ |
| VECTORBEA_API_KEY | Obtained from the VectorBea dashboard → API Keys |

---

## Docker Compose Quickstart

Suitable for local development, indie hackers, and single-host deployments.

### How it works

Docker Compose places the proxy and your application on the same named network. Your app reaches the proxy at `http://vectorbea-proxy:8080` using Docker's internal DNS — no port exposure needed.

### `docker-compose.yml`

```yaml
version: "3.9"

services:

  # ── Your application ────────────────────────────────────────────────────────
  # Replace this with your real service. The only requirement is that outbound
  # LLM calls are routed to http://vectorbea-proxy:8080 instead of directly to
  # the LLM provider.
  app:
    image: node:20-slim                    # swap for your own image/build context
    container_name: my-app
    working_dir: /app
    volumes:
      - ./app:/app                         # your source code
    command: node server.js
    environment:
      # Tell your application where to find the VectorBea proxy.
      VECTORBEA_PROXY_URL: http://vectorbea-proxy:8080
    depends_on:
      vectorbea-proxy:
        condition: service_healthy         # wait until the proxy is ready
    networks:
      - vectorbea-net
    ports:
      - "3000:3000"                        # expose your app to the host

  # ── VectorBea Proxy sidecar ─────────────────────────────────────────────────
  vectorbea-proxy:
    image: vectorbea/vectorbea-proxy:latest
    container_name: vectorbea-proxy
    restart: unless-stopped
    environment:
      # Required: API key issued from the VectorBea dashboard.
      VECTORBEA_API_KEY: ${VECTORBEA_API_KEY:?VECTORBEA_API_KEY must be set}
      # Required: URL of the VectorBea Hub (SaaS or self-hosted).
      VECTORBEA_HUB_URL: https://hub.vectorbea.io
      # Optional: proxy listen port (default 8080).
      PORT: 8080
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/health || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s
    networks:
      - vectorbea-net
    # Do NOT publish port 8080 to the host — keep the proxy internal.
    # Your app talks to it over the Docker network only.

networks:
  vectorbea-net:
    driver: bridge
```

### Running it

```bash
# 1. Set your API key (never commit this to source control)
export VECTORBEA_API_KEY=vb_your_key_here

# 2. Start the stack
docker compose up -d

# 3. Verify the proxy is healthy
docker compose ps
docker compose logs vectorbea-proxy
```

### Calling the proxy from your application

```js
// Node.js example
const response = await fetch(process.env.VECTORBEA_PROXY_URL + "/v1/prompt/invoke", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    promptName: "customer-support-reply",
    variables: { customerName: "Alice", issue: "billing" },
  }),
});
```

---

## Kubernetes Helm Chart

For production, multi-tenant, or highly available deployments, VectorBea ships as a Helm chart that uses the **sidecar pattern**: the proxy runs as a second container inside the same Pod as your application, communicating over `localhost`. This eliminates all network hops between your app and the proxy.

### Chart Scaffolding

Create the following directory structure in your repository:

```
charts/
└── my-app/
    ├── Chart.yaml
    ├── values.yaml
    └── templates/
        ├── deployment.yaml
        ├── service.yaml
        └── secret.yaml
```

#### `charts/my-app/Chart.yaml`

```yaml
apiVersion: v2
name: my-app
description: >
  Helm chart for My Application with the VectorBea Proxy sidecar.
  The proxy runs as a sidecar container within the same Pod, communicating
  with the application over localhost:8080.
type: application
version: 0.1.0       # Chart version — bump on every chart change
appVersion: "1.0.0"  # Your application's release version
keywords:
  - vectorbea
  - llm
  - proxy
  - sidecar
maintainers:
  - name: Platform Engineering
    email: platform@your-company.com
```

#### `charts/my-app/values.yaml`

```yaml
# ── Your application ──────────────────────────────────────────────────────────
app:
  image:
    repository: your-registry/my-app
    tag: latest
    pullPolicy: IfNotPresent
  port: 3000
  replicas: 2
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi

# ── VectorBea Proxy sidecar ───────────────────────────────────────────────────
vectorbea:
  image:
    repository: vectorbea/vectorbea-proxy
    tag: latest
    pullPolicy: IfNotPresent
  # Proxy listens on this port inside the Pod (localhost only).
  port: 8080
  hubUrl: https://hub.vectorbea.io
  resources:
    requests:
      cpu: 50m
      memory: 64Mi
    limits:
      cpu: 200m
      memory: 256Mi
  # API key secret configuration.
  # Option A (recommended): reference an existing Kubernetes Secret.
  #   existingSecret: "vectorbea-api-key-secret"
  #   existingSecretKey: "api-key"
  # Option B: let the chart create the Secret (avoid for production — see docs).
  apiKey: ""           # Leave blank when using existingSecret
  existingSecret: ""   # Name of a pre-created Secret (takes priority over apiKey)
  existingSecretKey: "api-key"
```

---

### Sidecar Deployment Template

#### `charts/my-app/templates/secret.yaml`

Only rendered when `vectorbea.existingSecret` is NOT set and `vectorbea.apiKey` is provided. For production, always pre-create the Secret with your secrets manager (Vault, AWS Secrets Manager, External Secrets Operator) and reference it via `existingSecret`.

```yaml
{{- if and (not .Values.vectorbea.existingSecret) .Values.vectorbea.apiKey }}
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "my-app.fullname" . }}-vectorbea
  labels:
    {{- include "my-app.labels" . | nindent 4 }}
type: Opaque
data:
  # Base64-encoded at install time by Helm — never stored in plaintext in etcd.
  api-key: {{ .Values.vectorbea.apiKey | b64enc | quote }}
{{- end }}
```

#### `charts/my-app/templates/deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "my-app.fullname" . }}
  labels:
    {{- include "my-app.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.app.replicas }}
  selector:
    matchLabels:
      {{- include "my-app.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "my-app.selectorLabels" . | nindent 8 }}
      annotations:
        # Force a rollout whenever the VectorBea API key secret changes.
        checksum/vectorbea-secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
    spec:
      # ── Pull secrets (if your registry is private) ─────────────────────────
      # imagePullSecrets:
      #   - name: regcred

      containers:

        # ── Container 1: Your Application ─────────────────────────────────────
        - name: app
          image: "{{ .Values.app.image.repository }}:{{ .Values.app.image.tag }}"
          imagePullPolicy: {{ .Values.app.image.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.app.port }}
              protocol: TCP
          env:
            # Point your app at the VectorBea proxy over localhost.
            # No service discovery needed — both containers share the Pod network.
            - name: VECTORBEA_PROXY_URL
              value: "http://localhost:{{ .Values.vectorbea.port }}"
          resources:
            {{- toYaml .Values.app.resources | nindent 12 }}
          livenessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 15
            periodSeconds: 20
          readinessProbe:
            httpGet:
              path: /ready
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10

        # ── Container 2: VectorBea Proxy Sidecar ──────────────────────────────
        # Shares the Pod's network namespace with the app container above.
        # Accessible at localhost:8080 from within the same Pod.
        # NOT exposed via the Service — internal to the Pod only.
        - name: vectorbea-proxy
          image: "{{ .Values.vectorbea.image.repository }}:{{ .Values.vectorbea.image.tag }}"
          imagePullPolicy: {{ .Values.vectorbea.image.pullPolicy }}
          ports:
            - name: proxy-http
              containerPort: {{ .Values.vectorbea.port }}
              protocol: TCP
          env:
            - name: PORT
              value: "{{ .Values.vectorbea.port }}"
            - name: VECTORBEA_HUB_URL
              value: {{ .Values.vectorbea.hubUrl | quote }}
            # Inject the API key from a Kubernetes Secret — never from values.yaml directly.
            - name: VECTORBEA_API_KEY
              valueFrom:
                secretKeyRef:
                  # Use existingSecret if provided, otherwise fall back to the
                  # Secret created by secret.yaml.
                  name: >-
                    {{- if .Values.vectorbea.existingSecret }}
                    {{- .Values.vectorbea.existingSecret }}
                    {{- else }}
                    {{- include "my-app.fullname" . }}-vectorbea
                    {{- end }}
                  key: {{ .Values.vectorbea.existingSecretKey | quote }}
          resources:
            {{- toYaml .Values.vectorbea.resources | nindent 12 }}
          livenessProbe:
            httpGet:
              path: /health
              port: proxy-http
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /health
              port: proxy-http
            initialDelaySeconds: 5
            periodSeconds: 10
          # The proxy sidecar must be ready before the app container starts
          # (Kubernetes 1.29+ sidecar feature gate — omit on older clusters).
          # restartPolicy: Always
```

---

### Passing Secrets Securely

**Never set `vectorbea.apiKey` in `values.yaml` for production.** Use one of the following approaches:

#### Option A — Pre-create the Secret manually (simplest)

```bash
kubectl create secret generic vectorbea-api-key-secret \
  --from-literal=api-key=vb_your_key_here \
  --namespace my-app
```

Then reference it in your `values.yaml` override:

```yaml
vectorbea:
  existingSecret: "vectorbea-api-key-secret"
  existingSecretKey: "api-key"
```

#### Option B — External Secrets Operator (recommended for enterprise)

If you use AWS Secrets Manager, HashiCorp Vault, or GCP Secret Manager, the [External Secrets Operator](https://external-secrets.io) syncs secrets into Kubernetes automatically:

```yaml
# external-secret.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: vectorbea-api-key-secret
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager   # your SecretStore name
    kind: SecretStore
  target:
    name: vectorbea-api-key-secret
    creationPolicy: Owner
  data:
    - secretKey: api-key
      remoteRef:
        key: production/vectorbea/api-key   # path in your secrets manager
```

#### Option C — Helm `--set` at install time (CI/CD pipelines)

```bash
helm upgrade --install my-app ./charts/my-app \
  --namespace my-app \
  --create-namespace \
  --set vectorbea.apiKey="$VECTORBEA_API_KEY"
```

> ⚠️ This encodes the key in the Helm release history. Use only for non-production environments or when your cluster has RBAC restricting `helm history` access.

---

### Installing the Chart

```bash
# 1. Create namespace
kubectl create namespace my-app

# 2. Pre-create the API key secret (Option A)
kubectl create secret generic vectorbea-api-key-secret \
  --from-literal=api-key=vb_your_key_here \
  --namespace my-app

# 3. Create a values override file (do NOT commit secrets here)
cat > my-values.yaml <<EOF
app:
  image:
    repository: your-registry/my-app
    tag: "1.2.3"
vectorbea:
  existingSecret: "vectorbea-api-key-secret"
  hubUrl: "https://hub.vectorbea.io"
EOF

# 4. Dry-run to verify rendered templates
helm upgrade --install my-app ./charts/my-app \
  --namespace my-app \
  --values my-values.yaml \
  --dry-run --debug

# 5. Deploy
helm upgrade --install my-app ./charts/my-app \
  --namespace my-app \
  --values my-values.yaml

# 6. Verify both containers are running in the same Pod
kubectl get pods -n my-app
kubectl describe pod -n my-app -l app.kubernetes.io/name=my-app
```

Expected output — both containers `Running` in a single Pod:

```
NAME                      READY   STATUS    RESTARTS   AGE
my-app-7d9f6b8c4-xk2lp   2/2     Running   0          45s
```

`2/2` confirms the app container and the VectorBea proxy sidecar are both healthy.

---

## Environment Variable Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `VECTORBEA_API_KEY` | ✅ | — | API key from the VectorBea dashboard. Used to authenticate against the Hub. |
| `VECTORBEA_HUB_URL` | ✅ | — | Base URL of the VectorBea Hub (`https://hub.vectorbea.io` for SaaS). |
| `PORT` | ❌ | `8080` | Port the proxy HTTP server listens on. |
| `LOG_LEVEL` | ❌ | `INFO` | Proxy log verbosity: `DEBUG`, `INFO`, `WARN`, `ERROR`. |
| `AUDIT_BATCH_SIZE` | ❌ | `50` | Number of audit events to buffer before flushing to the Hub. |
| `AUDIT_FLUSH_INTERVAL_MS` | ❌ | `5000` | Maximum milliseconds between audit flushes, regardless of batch size. |

---

## Health Checks

The proxy exposes a single health endpoint:

```
GET /health  →  200 OK  {"status":"ok","version":"1.x.x"}
```

Use this for:
- Docker Compose `healthcheck`
- Kubernetes liveness and readiness probes
- Load balancer target group health checks

---

## Troubleshooting

**`401 Unauthorized` from the proxy**  
Your `VECTORBEA_API_KEY` is invalid or expired. Regenerate it from the VectorBea dashboard under **API Keys**.

**App container can't reach the proxy**  
- Docker Compose: ensure both services are on the same named network and the app uses `http://vectorbea-proxy:8080`.
- Kubernetes: confirm both containers are in the same Pod (`kubectl describe pod`). The proxy is at `http://localhost:8080` — not via a Service.

**Proxy is healthy but prompts return `404`**  
The `promptName` in your request does not exist in the connected workspace. Check the VectorBea dashboard → **Prompts**.

**`ImagePullBackOff` on the proxy container**  
Confirm the image name is correct (`vectorbea/vectorbea-proxy:latest`) and that Docker Hub is reachable from your cluster. For air-gapped environments, mirror the image to your internal registry and update `values.vectorbea.image.repository` accordingly.
