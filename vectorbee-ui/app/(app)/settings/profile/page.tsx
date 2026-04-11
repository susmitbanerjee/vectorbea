import { Mail, Shield, User } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  return (
    <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">
      <AppHeader
        title="Profile"
        subtitle="Your account details and workspace role."
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              <CardTitle>Account</CardTitle>
            </div>
            <CardDescription>
              Identity information pulled from your authentication provider.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-sm font-semibold text-primary">
                U
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">Local Dev User</p>
                <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  <Mail className="h-3 w-3 shrink-0" />
                  dev@local.test
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Profile editing will be available after SSO / OAuth integration ships.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle>Role &amp; permissions</CardTitle>
            </div>
            <CardDescription>Your current role within this workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              {
                label: "Workspace role",
                value: "Admin",
                description: "Full access to prompts, API keys, and workspace settings.",
                variant: "default" as const,
              },
              {
                label: "Plan",
                value: "Free",
                description: "Upgrade to unlock higher request limits and team seats.",
                variant: "outline" as const,
              },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-muted/30 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">{row.description}</p>
                </div>
                <Badge variant={row.variant} className="shrink-0">
                  {row.value}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
