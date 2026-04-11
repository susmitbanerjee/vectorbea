"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: number;
  suffix?: string;
  icon: ReactNode;
  staggerIndex?: number;
}

function AnimatedNumber({ value, suffix }: { value: number; suffix?: string }) {
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) => {
    const n = Math.round(v);
    return n >= 1000 ? n.toLocaleString() : n.toString();
  });
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: 1.4,
      ease: [0.16, 1, 0.3, 1],
    });
    return controls.stop;
  }, [motionValue, value]);

  useEffect(() => {
    const unsub = rounded.on("change", (v) => {
      if (ref.current) ref.current.textContent = suffix ? `${v}${suffix}` : v;
    });
    return unsub;
  }, [rounded, suffix]);

  return (
    <span ref={ref} className="text-3xl font-semibold tracking-tight md:text-4xl">
      {suffix ? `0${suffix}` : "0"}
    </span>
  );
}

export function MetricCard({ label, value, suffix, icon, staggerIndex = 0 }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: staggerIndex * 0.1, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className="group relative overflow-hidden transition-shadow hover:shadow-md">
        <CardContent className="flex items-start justify-between gap-4 p-6">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {label}
            </p>
            <AnimatedNumber value={value} suffix={suffix} />
            <div className="pt-1">
              <Badge variant="success" className="gap-1.5">
                <span className="live-dot" />
                Live
              </Badge>
            </div>
          </div>
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              "bg-primary/10 text-primary transition-colors group-hover:bg-primary/15",
            )}
          >
            {icon}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
