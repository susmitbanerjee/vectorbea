import { AppHeader } from "@/components/layout/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function GovernanceReportsPage() {
  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Reports" subtitle="Audit-ready compliance reports for AI system releases" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-[#111111]">Governance report export</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-[#374151]">
            <p>Capability, version, applied policy pack, rule outcomes, approvals, rollout decision, incident links, and audit summary will be collected here.</p>
            <button type="button" disabled className="rounded-xl border border-[#D8CFC2] bg-[#FBFAF7] px-4 py-2 font-semibold text-[#6B7280]">
              Export PDF coming soon
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
