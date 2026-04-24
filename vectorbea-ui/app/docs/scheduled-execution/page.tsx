export const metadata = {
  title: "Scheduled Execution & Scripts - VectorBea Docs",
};

import Link from "next/link";
import {
  Calendar,
  Clock,
  Code2,
  GitBranch,
  Globe,
  RefreshCw,
  Server,
  Terminal,
  Webhook,
  Zap,
} from "lucide-react";
import {
  DocsCallout,
  DocsCard,
  DocsCardGrid,
  DocsPage,
  DocsSection,
  DocsTable,
} from "@/components/docs/docs-primitives";

// ── Integration patterns visual ───────────────────────────────────────────────

function IntegrationPattern({
  icon: Icon,
  title,
  description,
  example,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
  example: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/95 p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
          <Icon size={13} className="text-primary" />
        </div>
        <p className="text-[13px] font-semibold text-foreground">{title}</p>
      </div>
      <p className="mb-3 text-[12px] leading-5 text-muted-foreground">{description}</p>
      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
        <p className="font-mono text-[11px] text-muted-foreground">{example}</p>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ScheduledExecutionPage() {
  return (
    <DocsPage
      eyebrow="Scheduled Execution & Scripts"
      title="Automate regression and evaluation from any scheduler"
      lede="VectorBea does not include a built-in cron scheduler — instead it exposes API endpoints that any external scheduler, CI pipeline, or script can call. This gives you full control over timing, retry logic, and notification routing."
    >
      <DocsSection
        id="design"
        title="Design: external scheduler, VectorBea endpoint"
        description="The separation is intentional. Your infrastructure already has schedulers — VectorBea provides the API surface they call."
      >
        <DocsCallout title="Why no built-in scheduler?">
          Enterprise environments have existing scheduling infrastructure —
          Kubernetes CronJobs, AWS EventBridge, GitHub Actions scheduled workflows,
          Jenkins pipelines. Duplicating that inside VectorBea would add unnecessary
          overlap. Instead, VectorBea exposes clean REST endpoints that any scheduler
          can trigger with a single HTTP POST.
        </DocsCallout>
        <div className="grid gap-3 sm:grid-cols-2">
          <IntegrationPattern
            icon={GitBranch}
            title="CI/CD pipeline"
            description="Trigger regression after every merge to main. Block the deployment if the regression returns 'blocked'."
            example="POST /api/evaluations/regression-schedules/[id]/run"
          />
          <IntegrationPattern
            icon={Clock}
            title="Cron job"
            description="Run nightly regression on stable prompts. Use system cron, Kubernetes CronJob, or any cron-as-a-service."
            example="0 2 * * * curl -X POST https://app.vectorbea.com/api/..."
          />
          <IntegrationPattern
            icon={Webhook}
            title="Webhook / event-driven"
            description="Trigger regression when a new prompt version is published, or when upstream data changes."
            example="On: prompt.published → POST /api/evaluations/regression-schedules/[id]/run"
          />
          <IntegrationPattern
            icon={Terminal}
            title="Manual script"
            description="Run regression on demand from a shell script during incident investigation or pre-launch checks."
            example="bash run-regression.sh --schedule-id abc123 --env prod"
          />
        </div>
      </DocsSection>

      <DocsSection
        id="endpoints"
        title="Available API endpoints"
        description="All endpoints require an Authorization header with a workspace API key."
      >
        <DocsTable
          headers={["Endpoint", "Method", "Purpose"]}
          rows={[
            ["/api/evaluations/regression-schedules/[id]/run", "POST", "Trigger a regression schedule run immediately"],
            ["/api/evaluations/regression-schedules/[id]",     "GET",  "Fetch current status and last run result"],
            ["/api/evaluations/runs/[id]",                     "GET",  "Poll a specific run for completion status"],
            ["/api/evaluations",                               "POST", "Create a new evaluation run manually"],
            ["/api/alerts/[id]/evaluate",                      "POST", "Trigger an alert rule evaluation"],
          ]}
        />
        <DocsCallout title="Authentication">
          All endpoints use workspace API keys. Create a key in Settings → API Keys.
          Use the <code className="rounded bg-muted px-1 py-0.5 text-[12px] font-mono">Authorization: Bearer &lt;key&gt;</code> header.
          Keys can be scoped to read-only or read-write. Regression triggers require write scope.
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="github-actions"
        title="GitHub Actions example"
        description="Add a regression gate to your deployment workflow."
      >
        <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">.github/workflows/deploy.yml (excerpt)</p>
          <pre className="overflow-x-auto text-[11px] leading-relaxed text-foreground">
{`jobs:
  regression-gate:
    runs-on: ubuntu-latest
    steps:
      - name: Run VectorBea regression
        run: |
          RESULT=$(curl -s -X POST \\
            -H "Authorization: Bearer $VECTORBEA_API_KEY" \\
            https://app.vectorbea.com/api/evaluations/ \\
            regression-schedules/$SCHEDULE_ID/run)
          STATUS=$(echo $RESULT | jq -r '.status')
          echo "Regression status: $STATUS"
          if [ "$STATUS" = "blocked" ]; then
            echo "Regression blocked — halting deploy"
            exit 1
          fi
        env:
          VECTORBEA_API_KEY: \${{ secrets.VECTORBEA_API_KEY }}
          SCHEDULE_ID: \${{ vars.REGRESSION_SCHEDULE_ID }}`}
          </pre>
        </div>
      </DocsSection>

      <DocsSection
        id="kubernetes-cronjob"
        title="Kubernetes CronJob example"
        description="Schedule nightly regression using a Kubernetes CronJob."
      >
        <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">regression-cronjob.yaml</p>
          <pre className="overflow-x-auto text-[11px] leading-relaxed text-foreground">
{`apiVersion: batch/v1
kind: CronJob
metadata:
  name: vectorbea-nightly-regression
spec:
  schedule: "0 2 * * *"   # 2am UTC daily
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: regression
            image: curlimages/curl:latest
            command:
            - /bin/sh
            - -c
            - |
              curl -f -X POST \\
                -H "Authorization: Bearer $(VECTORBEA_API_KEY)" \\
                https://app.vectorbea.com/api/evaluations/ \\
                regression-schedules/$(SCHEDULE_ID)/run
          env:
          - name: VECTORBEA_API_KEY
            valueFrom:
              secretKeyRef:
                name: vectorbea-secrets
                key: api-key
          restartPolicy: OnFailure`}
          </pre>
        </div>
      </DocsSection>

      <DocsSection
        id="alert-evaluation"
        title="Triggering alert evaluations"
        description="Alert rules can also be evaluated on-demand via the API — useful for pre-deploy checks."
      >
        <DocsCallout title="Alert evaluation vs regression">
          Regression checks test prompt outputs against expected outputs. Alert
          evaluations check current metric values against threshold rules (e.g.
          &quot;error rate &gt; 5%&quot;). You can trigger both from the same CI step for
          comprehensive pre-deploy validation.
        </DocsCallout>
        <DocsTable
          headers={["Use case", "Endpoint to call"]}
          rows={[
            ["Test prompt outputs against expected",      "POST /api/evaluations/regression-schedules/[id]/run"],
            ["Check current metrics against thresholds",  "POST /api/alerts/[id]/evaluate"],
            ["Check both before deploy",                  "Call both endpoints; fail if either returns 'blocked' or 'firing'"],
          ]}
        />
      </DocsSection>

      <DocsSection id="connections" title="Related features">
        <DocsCardGrid>
          <DocsCard title="Regression Checks →" description="How regression schedules work and how to create them.">
            <Link href={"/docs/regression" as any} className="text-xs font-medium text-primary hover:underline">Regression docs →</Link>
          </DocsCard>
          <DocsCard title="API Keys →" description="Create and manage workspace API keys for use in CI and scripts.">
            <Link href={"/settings" as any} className="text-xs font-medium text-primary hover:underline">Settings → API Keys →</Link>
          </DocsCard>
        </DocsCardGrid>
      </DocsSection>
    </DocsPage>
  );
}
