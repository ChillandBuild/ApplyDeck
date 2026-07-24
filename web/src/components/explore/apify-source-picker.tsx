"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ApifySource = { name: string; actor: string; enabled: boolean };

export function ApifySourcePicker({
  selected,
  onChange,
  onLoaded,
}: {
  selected: string[];
  onChange: (names: string[]) => void;
  /** Fires once with the fetched list, so the parent (explore-provider) can
   *  decide the empty/blocked state without a second fetch. */
  onLoaded?: (sources: ApifySource[]) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<ApifySource[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portals/snapshot");
        const data = (await res.json()) as { apifySources?: ApifySource[] };
        const list = data.apifySources ?? [];
        if (!cancelled) {
          setSources(list);
          onLoaded?.(list);
        }
      } catch {
        if (!cancelled) onLoaded?.([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted">
        <Loader2 className="size-3.5 animate-spin" /> Loading Apify sources…
      </div>
    );
  }

  if (sources.length === 0) return null; // parent renders the empty state instead

  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((s) => {
        const on = selected.includes(s.name);
        return (
          <button
            key={s.name}
            type="button"
            onClick={() => toggle(s.name)}
            title={s.enabled ? undefined : "Not scheduled for unattended scanning — still runnable here"}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors max-sm:min-h-[44px]",
              on ? "border-brand/40 bg-brand-soft text-brand" : "border-border text-muted hover:text-foreground",
              !s.enabled && !on && "opacity-70",
            )}
          >
            {s.name}
          </button>
        );
      })}
    </div>
  );
}
