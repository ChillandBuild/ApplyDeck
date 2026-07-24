"use client";

import { Compass, Zap } from "lucide-react";
import { cn } from "@/lib/cn";
import { CostBadge } from "@/components/cost/cost-badge";
import type { ExploreMode } from "@/lib/explore";

export function ExploreModeToggle({
  mode,
  onChange,
}: {
  mode: ExploreMode;
  onChange: (m: ExploreMode) => void;
  cliConfigured?: boolean;
}) {
  return (
    <div className="flex w-full rounded-xl border border-border bg-surface/40 p-1 sm:inline-flex sm:w-auto">
      <button
        type="button"
        onClick={() => onChange("scan")}
        aria-pressed={mode === "scan"}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition-colors sm:flex-none sm:gap-2 sm:px-3 max-sm:min-h-[44px]",
          mode === "scan" ? "bg-brand-soft text-brand" : "text-muted hover:text-foreground",
        )}
      >
        <Compass className="size-4" />
        <span className="font-medium">Scan</span>
        <span className="hidden sm:inline-flex">
          <CostBadge kind="free-network" size="xs" />
        </span>
      </button>
      <button
        type="button"
        onClick={() => onChange("apify")}
        aria-pressed={mode === "apify"}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition-colors sm:flex-none sm:gap-2 sm:px-3 max-sm:min-h-[44px]",
          mode === "apify" ? "bg-brand-soft text-brand" : "text-muted hover:text-foreground",
        )}
      >
        <Zap className="size-4" />
        <span className="font-medium">Apify</span>
        <span className="hidden sm:inline-flex">
          <CostBadge kind="spend-apify" size="xs" />
        </span>
      </button>
    </div>
  );
}
