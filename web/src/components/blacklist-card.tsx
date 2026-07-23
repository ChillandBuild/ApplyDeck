"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, ShieldOff } from "lucide-react";
import { KeywordField, KEYWORD_FIELD_STYLE } from "@/components/keyword-field";

export function BlacklistCard() {
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/blacklist");
        const data = (await res.json()) as { companies: string[] };
        if (!cancelled) setCompanies(data.companies ?? []);
      } catch {
        if (!cancelled) setError("Could not load your blacklist.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (next: string[]) => {
    setCompanies(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/blacklist", { method: "PUT", body: JSON.stringify({ companies: next }) });
      if (!res.ok) throw new Error("save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setError("Could not save — try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-10 flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading your blacklist…
      </div>
    );
  }

  return (
    <div className="mt-10 border-t border-border pt-8">
      <style>{KEYWORD_FIELD_STYLE}</style>
      <div className="mb-1 flex items-center gap-2">
        <ShieldOff className="size-4 text-brand" />
        <h2 className="text-lg font-medium text-foreground">Do Not Apply</h2>
        {saving && <Loader2 className="size-3.5 animate-spin text-muted" />}
        {saved && <Check className="size-3.5 text-emerald-600" />}
      </div>
      <p className="mb-4 text-sm text-faint">
        Companies here are always skipped — by the scanner and by auto-submit — no matter how good the score is.
        Changes here take effect on the next scan or automation run.
      </p>
      <KeywordField values={companies} tone="exc" placeholder="Type a company name and press Enter…" onChange={save} />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
