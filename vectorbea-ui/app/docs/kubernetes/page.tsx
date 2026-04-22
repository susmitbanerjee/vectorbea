import { Callout, Code } from "@/components/docs/prose";

export const metadata = {
  title: "Kubernetes - VectorBea Docs",
};

export default function KubernetesDocsPage() {
  return (
    <article className="mx-auto max-w-[68ch] space-y-6 py-4 lg:py-8">
      <section className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Kubernetes
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Run VectorBea sidecars in your cluster
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          Deploy the sidecar as a standard Deployment and expose it as an internal ClusterIP service.
          Keep traffic local to your workloads while prompt control stays centralized.
        </p>
      </section>

      <section id="architecture" className="space-y-3 scroll-mt-24 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Architecture</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-7 text-muted-foreground">
          <li>One sidecar deployment per environment or namespace.</li>
          <li>Application services call sidecar over cluster-local DNS.</li>
          <li>Sidecar makes outbound HTTPS calls to VectorBea control plane.</li>
          <li>No inbound firewall rules are required.</li>
        </ul>
      </section>

      <section id="deploy-sidecar" className="space-y-3 scroll-mt-24 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Deploy sidecar</h2>
        <p className="text-sm leading-7 text-muted-foreground">
          Create a secret with your workspace sidecar token, then apply the deployment.
        </p>
        <Code lang="bash">{`kubectl create secret generic vectorbea-sidecar \
  --from-literal=VECTORBEA_KEY='vbagent_your_token_here'`}</Code>
        <Code lang="yaml">{`apiVersion: apps/v1
kind: Deployment
metadata:
  name: vectorbea-sidecar
spec:
  replicas: 2
  selector:
    matchLabels:
      app: vectorbea-sidecar
  template:
    metadata:
      labels:
        app: vectorbea-sidecar
    spec:
      containers:
        - name: sidecar
          image: vectorbea/vectorbea-proxy:latest
          ports:
            - containerPort: 8080
          env:
            - name: VECTORBEA_HUB_URL
              value: https://vectorbea.com
            - name: VECTORBEA_HTTP_PORT
              value: "8080"
            - name: VECTORBEA_ENABLE_TELEMETRY
              value: "false"
            - name: VECTORBEA_KEY
              valueFrom:
                secretKeyRef:
                  name: vectorbea-sidecar
                  key: VECTORBEA_KEY
---
apiVersion: v1
kind: Service
metadata:
  name: vectorbea-sidecar
spec:
  selector:
    app: vectorbea-sidecar
  ports:
    - name: http
      port: 8080
      targetPort: 8080
  type: ClusterIP`}</Code>
      </section>

      <section id="health-probes" className="space-y-3 scroll-mt-24 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Health and probes</h2>
        <p className="text-sm leading-7 text-muted-foreground">
          Use readiness and liveness probes to protect rollouts and restart unhealthy pods automatically.
        </p>
        <Code lang="yaml">{`readinessProbe:
  httpGet:
    path: /v1/prompts/healthcheck
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10

livenessProbe:
  httpGet:
    path: /v1/prompts/healthcheck
    port: 8080
  initialDelaySeconds: 15
  periodSeconds: 20`}</Code>
      </section>

      <section id="scaling-updates" className="space-y-3 scroll-mt-24 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Scaling and updates</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-7 text-muted-foreground">
          <li>Start with 2 replicas for production availability.</li>
          <li>Use rolling updates with maxUnavailable=0 for zero downtime.</li>
          <li>Pin image tags for controlled upgrades, then promote after canary validation.</li>
        </ul>
      </section>

      <section id="network-policy" className="space-y-3 scroll-mt-24 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Network policy</h2>
        <p className="text-sm leading-7 text-muted-foreground">
          Restrict sidecar egress to VectorBea control plane and required model providers only.
        </p>
        <Callout kind="info">
          Keep sidecar service internal-only. Do not expose it through an external LoadBalancer.
        </Callout>
      </section>
    </article>
  );
}
