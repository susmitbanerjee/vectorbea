"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  GitBranch,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/lib/workspace-context";

interface CiEvent {
  id: string;
  created_at: string;
  event_type: string;
  normalized_payload: {
    status?: string;
    branch?: string;
    commit_sha?: string;
    evidence_type?: string;
    run_url?: string | null;
  };
}

function StatusBadge({ status }: { status?: string }) {
  if (status === "passed") return <Badge className="bg-green-100 text-green-800">Passed</Badge>;
  if (status === "failed") return <Badge className="bg-red-100 text-red-800">Failed</Badge>;
  return <Badge className="bg-amber-100 text-amber-800">Needs review</Badge>;
}

function CodeBlock({ code, language = "yaml" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-lg border border-[#E7DED1] bg-[#1a1a1a] text-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="text-xs text-gray-400">{language}</span>
        <button onClick={() => { void navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors">
          <Copy className="h-3 w-3" />{copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-gray-200 leading-relaxed whitespace-pre">{code}</pre>
    </div>
  );
}

export default function CiCdIntegrationPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? "";
  const host = typeof window !== "undefined" ? window.location.origin : "https://your-vectorbea-instance.com";

  const [events, setEvents] = useState<CiEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [ingestToken, setIngestToken] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    void load();
  }, [workspaceId]);

  async function load() {
    setLoading(true);
    try {
      const [evtRes, tokRes] = await Promise.all([
        fetch(`/api/integrations/discovered-systems?workspaceId=${workspaceId}&sourceType=ci_cd&limit=20`),
        fetch(`/api/settings/ingest-tokens?workspaceId=${workspaceId}&limit=1`),
      ]);
      // We can't query evidence_source_events directly from the client, so show empty state
      // Real data would come from a dedicated /api/integrations/events?source=ci_cd endpoint
      if (tokRes.ok) {
        const d = await tokRes.json() as { tokens?: Array<{ token: string }> };
        if (d.tokens && d.tokens.length > 0) setIngestToken(d.tokens[0].token);
      }
    } finally {
      setLoading(false);
    }
  }

  const token = ingestToken ?? "<YOUR_INGEST_TOKEN>";
  const webhookUrl = `${host}/api/integrations/webhook/ci`;

  const githubActionsYaml = `name: AI Governance Evidence

on:
  push:
    branches: [main]
  pull_request:

jobs:
  governance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run AI regression tests
        id: tests
        run: |
          # Your existing test command
          npm run test:ai
        continue-on-error: true

      - name: Report evidence to VectorBea
        if: always()
        env:
          STATUS: \${{ steps.tests.outcome == 'success' && 'passed' || 'failed' }}
          BRANCH: \${{ github.ref_name }}
          COMMIT: \${{ github.sha }}
          RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}
        run: |
          curl -X POST "${webhookUrl}" \\
            -H "x-vectorbea-ingest-token: \${{ secrets.VECTORBEA_INGEST_TOKEN }}" \\
            -H "Content-Type: application/json" \\
            -d "{\\"ai_system_name\\": \\"my-agent\\", \\"evidence_type\\": \\"workflow_regression\\", \\"status\\": \\"$STATUS\\", \\"branch\\": \\"$BRANCH\\", \\"commit_sha\\": \\"$COMMIT\\", \\"run_url\\": \\"$RUN_URL\\"}"`;

  const gitlabCiYaml = `stages:
  - test
  - governance

ai_regression:
  stage: test
  script:
    - npm run test:ai
  artifacts:
    reports:
      junit: test-results.xml

report_evidence:
  stage: governance
  when: always
  script:
    - |
      STATUS="passed"
      if [ "\$CI_JOB_STATUS" != "success" ]; then STATUS="failed"; fi
      curl -X POST "${webhookUrl}" \\
        -H "x-vectorbea-ingest-token: \$VECTORBEA_INGEST_TOKEN" \\
        -H "Content-Type: application/json" \\
        -d "{
          \\"ai_system_name\\": \\"my-agent\\",
          \\"evidence_type\\": \\"workflow_regression\\",
          \\"status\\": \\"\$STATUS\\",
          \\"branch\\": \\"\$CI_COMMIT_REF_NAME\\",
          \\"commit_sha\\": \\"\$CI_COMMIT_SHA\\",
          \\"run_url\\": \\"\$CI_PIPELINE_URL\\"
        }"`;

  const curlExample = `# Direct API call
curl -X POST ${webhookUrl} \\
  -H "x-vectorbea-ingest-token: ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "ai_system_name": "my-agent",
    "evidence_type": "workflow_regression",
    "status": "passed",
    "branch": "main",
    "commit_sha": "abc123",
    "run_url": "https://github.com/org/repo/actions/runs/123",
    "test_results": {
      "total": 42,
      "passed": 42,
      "failed": 0
    }
  }'`;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="CI/CD Integration"
        subtitle="Report AI regression test evidence from your pipeline to VectorBea"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} className="gap-2 border-[#E7DED1]">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      <div className="mx-auto max-w-5xl space-y-6 p-6">

        {/* What it does */}
        <Card className="border-[#E7DED1] bg-white">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <GitBranch className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-[#111111]">CI/CD as governance evidence</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Every AI regression test run in your CI pipeline becomes governance evidence in VectorBea.
                  Release gates can require recent CI evidence before approving a deployment, giving you
                  automated proof that your AI system meets quality thresholds.
                </p>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm text-gray-600">
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> GitHub Actions</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> GitLab CI</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Any CI via curl</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Webhook URL + token */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Webhook endpoint & token</CardTitle>
              <a href="/settings/sdk" className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                Manage tokens <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Webhook URL</p>
              <div className="flex items-center gap-2 rounded-lg border border-[#E7DED1] bg-[#F8F5EF] px-3 py-2 font-mono text-sm">
                <span className="flex-1 truncate">{webhookUrl}</span>
                <button onClick={() => void navigator.clipboard.writeText(webhookUrl)} className="text-gray-400 hover:text-gray-700"><Copy className="h-4 w-4" /></button>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Ingest token (store as CI secret <code className="bg-gray-100 rounded px-1">VECTORBEA_INGEST_TOKEN</code>)</p>
              {ingestToken ? (
                <div className="flex items-center gap-2 rounded-lg border border-[#E7DED1] bg-[#F8F5EF] px-3 py-2 font-mono text-sm">
                  <span className="flex-1 truncate">{ingestToken}</span>
                  <button onClick={() => void navigator.clipboard.writeText(ingestToken)} className="text-gray-400 hover:text-gray-700"><Copy className="h-4 w-4" /></button>
                </div>
              ) : (
                <p className="text-sm text-gray-500">No token found. <a href="/settings/sdk" className="text-blue-600 hover:underline">Create one</a>.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* GitHub Actions */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">GitHub Actions workflow</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-3">
            <p className="text-sm text-gray-600">Add this as <code className="rounded bg-gray-100 px-1">.github/workflows/ai-governance.yml</code>:</p>
            <CodeBlock code={githubActionsYaml} language="yaml" />
          </CardContent>
        </Card>

        {/* GitLab CI */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">GitLab CI pipeline</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-3">
            <p className="text-sm text-gray-600">Append to your <code className="rounded bg-gray-100 px-1">.gitlab-ci.yml</code>:</p>
            <CodeBlock code={gitlabCiYaml} language="yaml" />
          </CardContent>
        </Card>

        {/* Direct curl */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">Any CI system (curl)</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-3">
            <p className="text-sm text-gray-600">Use curl in any shell step or Makefile target:</p>
            <CodeBlock code={curlExample} language="bash" />
          </CardContent>
        </Card>

        {/* Payload reference */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">Payload reference</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E7DED1] bg-[#F8F5EF]">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Field</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Required</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Description</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { f: "ai_system_name", req: true, d: "Name of the AI system (matched against registered systems)" },
                  { f: "status", req: true, d: "passed | failed | needs_review" },
                  { f: "ai_system_id", req: false, d: "Exact system UUID (overrides name matching)" },
                  { f: "evidence_type", req: false, d: "workflow_regression | performance_test | security_scan | …" },
                  { f: "branch", req: false, d: "Git branch name" },
                  { f: "commit_sha", req: false, d: "Git commit SHA" },
                  { f: "run_url", req: false, d: "Link to the CI run" },
                  { f: "artifact_url", req: false, d: "Link to test artifact / report" },
                  { f: "environment", req: false, d: "staging | production | …" },
                  { f: "test_results", req: false, d: "Arbitrary JSON with test counts / metrics" },
                ].map((r) => (
                  <tr key={r.f} className="border-b border-[#E7DED1] last:border-0">
                    <td className="px-4 py-2 font-mono text-xs text-blue-700">{r.f}</td>
                    <td className="px-4 py-2 text-xs">{r.req ? <span className="text-red-600 font-medium">Required</span> : <span className="text-gray-400">Optional</span>}</td>
                    <td className="px-4 py-2 text-xs text-gray-600">{r.d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
