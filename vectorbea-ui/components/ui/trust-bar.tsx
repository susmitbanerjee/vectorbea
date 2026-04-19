"use client";

import type { ComponentType, HTMLAttributes } from "react";
import {
  ArrowUpRight,
  Building2,
  Globe2,
  KeyRound,
  Lock,
  ScrollText,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type TrustSignalId =
  | "soc2"
  | "sso"
  | "audit"
  | "encryption"
  | "residency"
  | "hipaa"
  | "gdpr"
  | "iso27001";

type TrustSignalStatus = "active" | "in-progress" | "available";
type TrustBarVariant = "hero" | "compact" | "card";
type TrustBarDensity = "default" | "dense";

export type TrustSignal = {
  id: TrustSignalId;
  label: string;
  subtitle?: string;
  reportUrl?: string;
  status: TrustSignalStatus;
};

const signalIcons: Record<TrustSignalId, ComponentType<{ className?: string }>> = {
  soc2: ShieldCheck,
  sso: KeyRound,
  audit: ScrollText,
  encryption: Lock,
  residency: Globe2,
  hipaa: ShieldCheck,
  gdpr: Globe2,
  iso27001: Building2,
};

const statusBadge: Record<TrustSignalStatus, { label: string; variant: "success" | "outline" | "secondary" }> = {
  active: { label: "Active", variant: "success" },
  available: { label: "Available", variant: "outline" },
  "in-progress": { label: "In progress", variant: "secondary" },
};

export const coreTrustSignals: TrustSignal[] = [
  {
    id: "soc2",
    label: "SOC 2 Type II",
    subtitle: "Audited controls and report process",
    status: "available",
  },
  {
    id: "sso",
    label: "SSO / SAML",
    subtitle: "Google, Microsoft, and enterprise identity",
    status: "active",
  },
  {
    id: "audit",
    label: "Audit logs",
    subtitle: "Prompt execution, rollout, and operator history",
    status: "active",
  },
  {
    id: "encryption",
    label: "Encryption at rest",
    subtitle: "Secrets and control-plane data encrypted by default",
    status: "active",
  },
  {
    id: "residency",
    label: "Data residency",
    subtitle: "Regional deployment planning for enterprise teams",
    status: "in-progress",
  },
];

export interface TrustBarProps extends HTMLAttributes<HTMLDivElement> {
  signals: TrustSignal[];
  variant?: TrustBarVariant;
  density?: TrustBarDensity;
  showProof?: boolean;
  onSignalClick?: (signal: TrustSignal) => void;
}

function SignalSurface({
  signal,
  variant,
  showProof,
  onSignalClick,
}: {
  signal: TrustSignal;
  variant: TrustBarVariant;
  showProof: boolean;
  onSignalClick?: (signal: TrustSignal) => void;
}) {
  const Icon = signalIcons[signal.id];
  const proof = showProof && signal.reportUrl;
  const clickable = typeof onSignalClick === "function" || Boolean(signal.reportUrl);
  const Root = clickable ? "button" : "div";

  return (
    <Root
      type={clickable ? "button" : undefined}
      className={cn(
        "text-left transition-colors",
        clickable &&
          "cursor-pointer hover:border-border hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        variant === "card"
          ? "rounded-2xl border border-border/70 bg-card/70 p-4"
          : "rounded-xl",
      )}
      onClick={() => {
        if (onSignalClick) onSignalClick(signal);
        if (!onSignalClick && signal.reportUrl) window.open(signal.reportUrl, "_blank", "noopener,noreferrer");
      }}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">{signal.label}</p>
            <Badge variant={statusBadge[signal.status].variant}>
              {statusBadge[signal.status].label}
            </Badge>
          </div>
          {signal.subtitle ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{signal.subtitle}</p>
          ) : null}
          {proof ? (
            <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
              View proof
              <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          ) : null}
        </div>
      </div>
    </Root>
  );
}

export function TrustBar({
  signals,
  variant = "hero",
  density = "default",
  showProof = true,
  onSignalClick,
  className,
  ...props
}: TrustBarProps) {
  if (variant === "compact") {
    return (
      <div
        className={cn(
          "rounded-xl border border-border/70 bg-card/70 px-4 py-3 backdrop-blur",
          className,
        )}
        {...props}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          {signals.map((signal, index) => {
            const Icon = signalIcons[signal.id];
            return (
              <div key={signal.id} className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-primary" />
                <span className="font-medium text-foreground">{signal.label}</span>
                {index < signals.length - 1 ? (
                  <span className="text-border">·</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (variant === "card") {
    return (
      <div
        className={cn(
          "grid gap-3 sm:grid-cols-2 xl:grid-cols-3",
          className,
        )}
        {...props}
      >
        {signals.map((signal) => (
          <SignalSurface
            key={signal.id}
            signal={signal}
            variant={variant}
            showProof={showProof}
            onSignalClick={onSignalClick}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/70 bg-card/70 backdrop-blur",
        density === "dense" ? "px-4 py-3" : "px-5 py-4",
        className,
      )}
      {...props}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {signals.map((signal) => (
          <div
            key={signal.id}
            className="flex items-start gap-3 rounded-xl border border-border/50 bg-background/40 px-3 py-3"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {(() => {
                const Icon = signalIcons[signal.id];
                return <Icon className="h-4 w-4" />;
              })()}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{signal.label}</p>
              {signal.subtitle ? (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{signal.subtitle}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
