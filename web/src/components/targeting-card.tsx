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
  apify: {
    present: boolean;
    enabled: boolean;
    position: string;
    country: string;
    area: string;
    maxItems: number;
  } | null;
};

const SCHEDULE_OPTIONS = [3, 6, 12, 24];

export function TargetingCard() {
  const [loading, setLoading] = useState(true);
  const [positive, setPositive] = useState<string[]>([]);
  const [negative, setNegative] = useState<string[]>([]);
  const [alwaysAllow, setAlwaysAllow] = useState<string[]>([]);
  const [block, setBlock] = useState<string[]>([]);
  const [apifyPresent, setApifyPresent] = useState(false);
  const [apifyEnabled, setApifyEnabled] = useState(false);
  const [apifyPosition, setApifyPosition] = useState("");
  const [apifyCountry, setApifyCountry] = useState("");
  const [apifyArea, setApifyArea] = useState("");
  const [apifyMaxItems, setApifyMaxItems] = useState(25);
  const [apifyTokenConfigured, setApifyTokenConfigured] = useState(false);
  const [typedApifyToken, setTypedApifyToken] = useState("");
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [scheduleHours, setScheduleHours] = useState(6);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [portalsRes, automationRes, secretRes] = await Promise.all([
          fetch("/api/portals/snapshot"),
          fetch("/api/automation"),
          fetch("/api/secrets/apify-token"),
        ]);
        const portals = (await portalsRes.json()) as PortalsSnapshot;
        const automation = (await automationRes.json()) as { scheduleHours: number };
        const secret = (await secretRes.json()) as { configured: boolean };
        if (cancelled) return;
        setPositive(portals.positive ?? []);
        setNegative(portals.negative ?? []);
        setAlwaysAllow(portals.alwaysAllow ?? []);
        setBlock(portals.block ?? []);
        if (portals.apify) {
          setApifyPresent(portals.apify.present);
          setApifyEnabled(portals.apify.enabled);
          setApifyPosition(portals.apify.position);
          setApifyCountry(portals.apify.country);
          setApifyArea(portals.apify.area);
          setApifyMaxItems(portals.apify.maxItems);
        }
        setScheduleHours(automation.scheduleHours ?? 6);
        setApifyTokenConfigured(!!secret.configured);
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

  const saveToken = async (val: string) => {
    setTokenSaving(true);
    setTokenError(null);
    try {
      const res = await fetch("/api/secrets/apify-token", {
        method: "PUT",
        body: JSON.stringify({ token: val }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "could not save token");
      }
      const data = await res.json();
      setApifyTokenConfigured(!!data.configured);
      setTypedApifyToken("");
    } catch (e) {
      setTokenError(e instanceof Error ? e.message : "could not save token");
    } finally {
      setTokenSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const portalsBody: Record<string, unknown> = { positive, negative, alwaysAllow, block };
      if (apifyPresent) {
        portalsBody.apify = {
          enabled: apifyEnabled,
          position: apifyPosition,
          country: apifyCountry,
          area: apifyArea,
          maxItems: apifyMaxItems,
        };
      }
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
      <div className="mt-10 flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading your targeting…
      </div>
    );
  }

  return (
    <div className="mt-10 border-t border-border pt-8">
      <style>{KEYWORD_FIELD_STYLE}</style>
      <h2 className="mb-1 text-lg font-medium text-foreground">🎯 Job Targeting</h2>
      <p className="mb-6 text-sm text-faint">What ApplyDeck hunts for. Changes apply from the next scan.</p>

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

        {apifyPresent && (
          <div className="rounded-xl border border-border bg-surface/30 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Indeed search</span>
              <button
                type="button"
                role="switch"
                aria-checked={apifyEnabled}
                onClick={() => setApifyEnabled((v) => !v)}
                className={cn("relative h-6 w-11 rounded-full transition-colors", apifyEnabled ? "bg-brand" : "bg-surface-hover")}
              >
                <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform", apifyEnabled ? "translate-x-[1.375rem]" : "translate-x-0.5")} />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted">
                Search for
                <input value={apifyPosition} onChange={(e) => setApifyPosition(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-muted">
                Country
                <input value={apifyCountry} onChange={(e) => setApifyCountry(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-muted">
                Area
                <input value={apifyArea} onChange={(e) => setApifyArea(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-muted">
                Max results <span className="text-faint">(caps at 50)</span>
                <input type="number" min={1} max={50} value={apifyMaxItems} onChange={(e) => setApifyMaxItems(Number(e.target.value))} className="mt-1 w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm" />
              </label>
            </div>

            <div className="border-t border-border/60 pt-3">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted font-medium">Apify Token</span>
                <span className="text-faint">
                  {apifyTokenConfigured ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-emerald-500" /> Using your own token{" "}
                      <button type="button" onClick={() => saveToken("")} className="text-brand hover:underline">
                        (Clear)
                      </button>
                    </span>
                  ) : (
                    "Using the shared token"
                  )}
                </span>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={typedApifyToken}
                  onChange={(e) => setTypedApifyToken(e.target.value)}
                  onBlur={() => typedApifyToken.trim() && saveToken(typedApifyToken.trim())}
                  placeholder="Paste your own Apify token…"
                  autoComplete="off"
                  className="flex-1 rounded-md border border-border bg-surface/40 px-2 py-1.5 font-mono text-sm outline-none placeholder:text-faint"
                />
                <button
                  type="button"
                  onClick={() => typedApifyToken.trim() && saveToken(typedApifyToken.trim())}
                  disabled={tokenSaving || !typedApifyToken.trim()}
                  className="rounded-md border border-border bg-surface-hover px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
                >
                  {tokenSaving ? <Loader2 className="size-3 animate-spin" /> : "Save token"}
                </button>
              </div>
              {tokenError && <p className="mt-1 text-xs text-red-600">{tokenError}</p>}
              <p className="mt-1.5 text-xs text-faint">
                Your token is stored locally in this instance's <code className="font-mono text-[11px]">.env</code> file and is never shown again after saving. Takes effect on the next scan — no restart needed.
              </p>
            </div>
          </div>
        )}

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

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-60 max-sm:min-h-[44px]"
      >
        {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
        {saving ? "Saving…" : saved ? "Saved" : "Save targeting"}
      </button>
    </div>
  );
}
