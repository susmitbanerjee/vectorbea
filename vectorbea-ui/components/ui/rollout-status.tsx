"use client";

import { type ComponentType, type HTMLAttributes, type ReactNode } from "react";
import {
  CheckCircle2,
  FlaskConical,
  PencilLine,
  TrendingUp,
  Undo2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type RolloutStage = "draft" | "canary" | "ramp" | "full" | "rolled-back";
type RolloutVariant = "inline" | "card" | "hero";
type RolloutSize = "sm" | "md";

type StageConfig = {
  label: string;
  shortLabel: string;
  badgeVariant: "secondary" | "outline" | "success" | "destructive";
  icon: ComponentType<{ className?: string }>;
  tone: string;
  fill: string;
  iconTone: string;
};

const stageConfig: Record<RolloutStage, StageConfig> = {
  draft: {
    label: "Draft",
    shortLabel: "Draft",
    badgeVariant: "secondary",
    icon: PencilLine,
    tone: "text-muted-foreground",
    fill: "bg-zinc-400 dark:bg-zinc-500",
    iconTone: "text-muted-foreground",
  },
  canary: {
    label: "Canary",
    shortLabel: "Canary",
    badgeVariant: "outline",
    icon: FlaskConical,
    tone: "text-primary",
    fill: "bg-primary",
    iconTone: "text-primary",
  },
  ramp: {
    label: "Ramp",
    shortLabel: "Ramp",
    badgeVariant: "outline",
    icon: TrendingUp,
    tone: "text-cyan-600 dark:text-cyan-400",
    fill: "bg-cyan-500",
    iconTone: "text-cyan-600 dark:text-cyan-400",
  },
  full: {
    label: "Full rollout",
    shortLabel: "Full",
    badgeVariant: "success",
    icon: CheckCircle2,
    tone: "text-emerald-600 dark:text-emerald-400",
    fill: "bg-emerald-500",
    iconTone: "text-emerald-600 dark:text-emerald-400",
  },
  "rolled-back": {
    label: "Rolled back",
    shortLabel: "Rollback",
    badgeVariant: "destructive",
    icon: Undo2,
    tone: "text-red-600 dark:text-red-400",
    fill: "bg-red-500",
    iconTone: "text-red-600 dark:text-red-400",
  },
};

function clampPercent(value: number) {
  return Math.min(Math.max(Math.round(value), 0), 100);
}

function formatRelativeTime(value?: Date | string | null) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const elapsedMs = date.getTime() - Date.now();
  const absoluteSeconds = Math.round(Math.abs(elapsedMs) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absoluteSeconds < 60) return formatter.format(Math.round(elapsedMs / 1000), "second");
  if (absoluteSeconds < 3600) return formatter.format(Math.round(elapsedMs / 60000), "minute");
  if (absoluteSeconds < 86400) return formatter.format(Math.round(elapsedMs / 3600000), "hour");
  return formatter.format(Math.round(elapsedMs / 86400000), "day");
}

export interface RolloutStatusProps extends HTMLAttributes<HTMLDivElement> {
  version: string;
  stage: RolloutStage;
  progress?: number;
  target?: number;
  policy?: string | null;
  variant?: RolloutVariant;
  startedAt?: Date | string | null;
  size?: RolloutSize;
  onClick?: () => void;
  label?: string;
  meta?: ReactNode;
}

export function RolloutStatus({
  version,
  stage,
  progress = 0,
  target,
  policy,
  variant = "inline",
  startedAt,
  size = "md",
  onClick,
  label,
  meta,
  className,
  ...props
}: RolloutStatusProps) {
  const config = stageConfig[stage];
  const Icon = config.icon;
  const safeProgress = clampPercent(progress);
  const safeTarget = clampPercent(target ?? progress);
  const relativeTime = formatRelativeTime(startedAt);
  const interactive = typeof onClick === "function";
  const contentClassName = cn(
    "group inline-flex items-center gap-2 rounded-xl border border-border/70 bg-card/70 px-3 py-2 text-left transition-colors",
    interactive && "cursor-pointer hover:border-border hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
    size === "sm" ? "min-h-10" : "min-h-11",
    className,
  );

  if (variant === "inline") {
    const content = (
      <>
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("rounded-full bg-muted/60 p-1.5", config.iconTone)}>
            <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {version}
              </span>
              {label ? (
                <span className="truncate text-sm font-medium text-foreground">{label}</span>
              ) : null}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted/70">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-300",
                    config.fill,
                    (stage === "canary" || stage === "ramp") && "motion-safe:animate-pulse",
                  )}
                  style={{ width: `${safeProgress}%` }}
                />
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {safeProgress}/{safeTarget}%
              </span>
            </div>
          </div>
        </div>
        <Badge variant={config.badgeVariant} className="ml-auto shrink-0">
          {config.shortLabel}
        </Badge>
      </>
    );

    if (interactive) {
      return (
        <button
          type="button"
          className={contentClassName}
          onClick={onClick}
        >
          {content}
        </button>
      );
    }

    return (
      <div className={contentClassName} {...props}>
        {content}
      </div>
    );
  }

  const isHero = variant === "hero";
  const shellClassName = cn(
    "group rounded-[1.25rem] border bg-card/80 text-left shadow-sm backdrop-blur transition-all",
    stage === "rolled-back"
      ? "border-red-500/25 bg-red-500/5"
      : "border-border/70",
    isHero
      ? "overflow-hidden rounded-[1.5rem] border-white/10 bg-white/[0.04] p-5 text-white shadow-[0_24px_70px_-40px_rgba(0,0,0,0.75)]"
      : "p-4",
    interactive &&
      "cursor-pointer hover:-translate-y-0.5 hover:border-border hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
    className,
  );
  const content = (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-xl bg-muted/50",
                isHero ? config.iconTone.replace("text-", "text-") : config.iconTone,
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div>
              <p
                className={cn(
                  "font-mono text-xs font-semibold uppercase tracking-[0.2em]",
                  isHero ? "text-zinc-400" : "text-muted-foreground",
                )}
              >
                {version}
              </p>
              {label ? (
                <p
                  className={cn(
                    "text-sm font-medium",
                    isHero ? "text-white" : "text-foreground",
                  )}
                >
                  {label}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={config.badgeVariant}>{config.label}</Badge>
            {policy ? (
              <span
                className={cn(
                  "text-xs",
                  isHero ? "text-zinc-400" : "text-muted-foreground",
                )}
              >
                {policy}
              </span>
            ) : null}
          </div>
        </div>

        <div className="text-right">
          <p
            className={cn(
              "font-mono text-lg font-semibold tabular-nums",
              isHero ? "text-white" : "text-foreground",
            )}
          >
            {safeProgress}/{safeTarget}%
          </p>
          {meta ? (
            <div
              className={cn(
                "mt-1 text-xs",
                isHero ? "text-zinc-400" : "text-muted-foreground",
              )}
            >
              {meta}
            </div>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "mt-4 h-2.5 overflow-hidden rounded-full",
          isHero ? "bg-white/10" : "bg-muted/70",
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            config.fill,
            (stage === "canary" || stage === "ramp") && "motion-safe:animate-pulse",
          )}
          style={{ width: `${safeProgress}%` }}
        />
      </div>

      <div
        className={cn(
          "mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs",
          isHero ? "text-zinc-400" : "text-muted-foreground",
        )}
      >
        {relativeTime ? <span>Started {relativeTime}</span> : null}
        {safeTarget > safeProgress ? <span>Next stage: {safeTarget}%</span> : null}
        {!relativeTime && !policy && !meta ? <span>Rollout visible at the infrastructure layer</span> : null}
      </div>
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        className={shellClassName}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={shellClassName} {...props}>
      {content}
    </div>
  );
}

export function derivePromptRollout(prompt: {
  latestVersion: string;
  isPublished: boolean;
}) {
  if (!prompt.isPublished) {
    return {
      version: prompt.latestVersion,
      stage: "draft" as const,
      progress: 0,
      target: 0,
      policy: "Awaiting publish",
    };
  }

  return {
    version: prompt.latestVersion,
    stage: "full" as const,
    progress: 100,
    target: 100,
    policy: "Manual gate",
  };
}
