"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { KeywordField, KEYWORD_FIELD_STYLE } from "@/components/keyword-field";

const VENDOR_LABELS: Record<string, string> = {
  greenhouse: "Greenhouse",
  ashby: "Ashby",
  lever: "Lever",
  workday: "Workday",
};
const VENDOR_KEYS = Object.keys(VENDOR_LABELS);

type AutomationSnapshot = {
  tier: "draft" | "autonomous";
  scoreThreshold: number;
  dailySubmitCap: number;
  perRunCap: number;
  companyAllowlist: string[];
  safeVendors: string[];
};

export function AutomationSafetyCard() {
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<"draft" | "autonomous">("draft");
  const [scoreThreshold, setScoreThreshold] = useState(4.5);
  const [dailySubmitCap, setDailySubmitCap] = useState(3);
  const [perRunCap, setPerRunCap] = useState(2);
  const [companyAllowlist, setCompanyAllowlist] = useState<string[]>([]);
  const [safeVendors, setSafeVendors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tierSaving, setTierSaving] = useState(false);
  const [tierError, setTierError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/automation");
        const data = (await res.json()) as AutomationSnapshot;
        if (cancelled) return;
        setTier(data.tier);
        setScoreThreshold(data.scoreThreshold);
        setDailySubmitCap(data.dailySubmitCap);
        setPerRunCap(data.perRunCap);
        setCompanyAllowlist(data.companyAllowlist ?? []);
        setSafeVendors(data.safeVendors ?? []);
      } catch {
        if (!cancelled) setError("Could not load automation settings — check the server is running.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleVendor = (v: string) => {
    setSafeVendors((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  };

  const requestTierChange = async (next: "draft" | "autonomous") => {
    if (next === tier || tierSaving) return;
    if (next === "autonomous") {
      const ok = window.confirm(
        "Turn auto-submit ON?\n\nApplyDeck will be able to submit applications on your behalf, automatically, without you reviewing them first — within the limits set below (minimum score, daily cap, allowed companies/platforms).\n\nYou can turn this off again at any time.",
      );
      if (!ok) return;
    }
    setTierSaving(true);
    setTierError(null);
    try {
      const res = await fetch("/api/automation", {
        method: "PUT",
        body: JSON.stringify({ tier: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "could not change auto-submit");
      }
      setTier(next);
    } catch (e) {
      setTierError(e instanceof Error ? e.message : "could not change auto-submit");
    } finally {
      setTierSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/automation", {
        method: "PUT",
        body: JSON.stringify({
          scoreThreshold,
          dailySubmitCap,
          perRunCap,
          companyAllowlist,
          safeVendors,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "save failed");
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
      <div className="mt-10 flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading automation settings…
      </div>
    );
  }

  return (
    <div className="mt-10 border-t border-border pt-8">
      <style>{KEYWORD_FIELD_STYLE}</style>
      <div className="mb-1 flex items-center gap-2">
        <ShieldAlert className="size-4 text-brand" />
        <h2 className="text-lg font-medium text-foreground">Automation Safety</h2>
      </div>
      <p className="mb-1 text-sm text-faint">
        How cautious auto-submit is. These limits only matter when auto-submit is actually on.
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={tier === "autonomous"}
          disabled={tierSaving}
          onClick={() => requestTierChange(tier === "autonomous" ? "draft" : "autonomous")}
          className={cn(
            "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
            tier === "autonomous" ? "bg-red-500" : "bg-border",
          )}
        >
          <span
            className={cn(
              "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
              tier === "autonomous" ? "translate-x-6" : "translate-x-1",
            )}
          />
        </button>
        <div
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
            tier === "autonomous"
              ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              : "border-border bg-surface-hover text-muted",
          )}
        >
          <span className={cn("size-1.5 rounded-full", tier === "autonomous" ? "bg-red-500" : "bg-muted")} />
          Auto-submit is {tierSaving ? "updating…" : tier === "autonomous" ? "ON" : "OFF"}
        </div>
      </div>
      <p className="mb-6 text-xs text-faint">
        When OFF, ApplyDeck prepares applications for you to review and send yourself. When ON, it submits on its own —
        but only for jobs that clear every limit below.
      </p>
      {tierError && <p className="mb-6 -mt-4 text-xs text-red-600">{tierError}</p>}

      <div className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-3">
          <label className="text-xs text-muted">
            Minimum score to auto-submit
            <input
              type="number"
              min={1}
              max={5}
              step={0.1}
              value={scoreThreshold}
              onChange={(e) => setScoreThreshold(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-muted">
            Max auto-submits per day
            <input
              type="number"
              min={0}
              max={20}
              value={dailySubmitCap}
              onChange={(e) => setDailySubmitCap(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-muted">
            Max auto-submits per run
            <input
              type="number"
              min={0}
              max={20}
              value={perRunCap}
              onChange={(e) => setPerRunCap(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Only submit on these job-board platforms
          </label>
          <div className="flex flex-wrap gap-2">
            {VENDOR_KEYS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => toggleVendor(v)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  safeVendors.includes(v)
                    ? "border-brand/50 bg-brand-soft text-brand"
                    : "border-border bg-surface/50 text-muted hover:bg-surface-hover",
                )}
              >
                {VENDOR_LABELS[v]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-faint">Job boards not on this list always fall back to draft, never auto-submit.</p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Only auto-submit to these companies
          </label>
          <KeywordField
            values={companyAllowlist}
            tone="inc"
            placeholder="Leave empty to allow any company…"
            onChange={setCompanyAllowlist}
          />
          <p className="mt-1.5 text-xs text-faint">
            {companyAllowlist.length === 0
              ? "Empty = any company that clears the other checks is eligible."
              : `Only the ${companyAllowlist.length} compan${companyAllowlist.length === 1 ? "y" : "ies"} listed above are eligible.`}
          </p>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-60 max-sm:min-h-[44px]"
      >
        {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
        {saving ? "Saving…" : saved ? "Saved" : "Save automation settings"}
      </button>
    </div>
  );
}
