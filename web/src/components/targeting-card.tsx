"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { KeywordField, KEYWORD_FIELD_STYLE } from "@/components/keyword-field";

type PortalsSnapshot = {
  positive: string[];
  negative: string[];
  alwaysAllow: string[];
  block: string[];
};

const SCHEDULE_OPTIONS = [3, 6, 12, 24];

export function TargetingCard() {
  const [loading, setLoading] = useState(true);
  const [positive, setPositive] = useState<string[]>([]);
  const [negative, setNegative] = useState<string[]>([]);
  const [alwaysAllow, setAlwaysAllow] = useState<string[]>([]);
  const [block, setBlock] = useState<string[]>([]);
  const [scheduleHours, setScheduleHours] = useState(6);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [portalsRes, automationRes] = await Promise.all([
          fetch("/api/portals/snapshot"),
          fetch("/api/automation"),
        ]);
        const portals = (await portalsRes.json()) as PortalsSnapshot;
        const automation = (await automationRes.json()) as { scheduleHours: number };
        if (cancelled) return;
        setPositive(portals.positive ?? []);
        setNegative(portals.negative ?? []);
        setAlwaysAllow(portals.alwaysAllow ?? []);
        setBlock(portals.block ?? []);
        setScheduleHours(automation.scheduleHours ?? 6);
      } catch {
        if (!cancelled) setError("Could not load current targeting — check the server is running.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const portalsBody = { positive, negative, alwaysAllow, block };
      const [r1, r2] = await Promise.all([
        fetch("/api/portals", { method: "PUT", body: JSON.stringify(portalsBody) }),
        fetch("/api/automation", { method: "PUT", body: JSON.stringify({ scheduleHours }) }),
      ]);
      if (!r1.ok || !r2.ok) {
        const j1 = await r1.json().catch(() => ({}));
        const j2 = await r2.json().catch(() => ({}));
        throw new Error(j1.error || j2.error || "save failed");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted py-4">
        <Loader2 className="size-4 animate-spin" /> Loading your targeting…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <style>{KEYWORD_FIELD_STYLE}</style>
      <div>
        <h2 className="text-lg font-medium text-foreground">🎯 Job Targeting</h2>
        <p className="text-sm text-faint">What ApplyDeck hunts for. Changes apply from the next scan.</p>
      </div>

      <div className="space-y-5">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">Roles I want</label>
          <KeywordField values={positive} tone="inc" placeholder="Intern, Machine Learning, LLM…" onChange={setPositive} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">Roles to exclude</label>
          <KeywordField values={negative} tone="exc" placeholder="Senior, Staff, Sales…" onChange={setNegative} />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">Preferred locations</label>
            <KeywordField values={alwaysAllow} tone="inc" placeholder="Coimbatore, Tamil Nadu, Remote…" onChange={setAlwaysAllow} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">Locations to block</label>
            <KeywordField values={block} tone="exc" placeholder="Poland…" onChange={setBlock} />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">Scan every</label>
          <div className="flex gap-2">
            {SCHEDULE_OPTIONS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setScheduleHours(h)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  scheduleHours === h ? "border-brand/50 bg-brand-soft text-brand" : "border-border bg-surface/50 text-muted hover:bg-surface-hover",
                )}
              >
                {h}h
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-faint">Runs through your connected AI tool. Takes effect on the next loop restart.</p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-60 max-sm:min-h-[44px]"
      >
        {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
        {saving ? "Saving…" : saved ? "Saved" : "Save targeting"}
      </button>
    </div>
  );
}
