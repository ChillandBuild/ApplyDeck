"use client";

import { useEffect, useState } from "react";
import { Loader2, Zap, Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ApifyPlatformMeta } from "@/components/explore/apify-composer";

type ApifySearchConfig = {
  enabled: boolean;
  keywords: string[];
  platforms: string[];
  location: string;
  country: string;
  max: number;
};

export function ScheduledApifyCard() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["indeed"]);
  const [platformsMeta, setPlatformsMeta] = useState<ApifyPlatformMeta[]>([]);
  const [location, setLocation] = useState("");
  const [country, setCountry] = useState("US");
  const [max, setMax] = useState(20);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [configRes, platformsRes] = await Promise.all([
          fetch("/api/apify/search-config"),
          fetch("/api/apify/platforms"),
        ]);
        const configData = (await configRes.json()) as ApifySearchConfig;
        const platformsData = (await platformsRes.json()) as { platforms?: ApifyPlatformMeta[] };

        if (!cancelled) {
          setEnabled(configData.enabled !== false);
          setKeywords(configData.keywords ?? []);
          setSelectedPlatforms(configData.platforms ?? ["indeed"]);
          setLocation(configData.location ?? "");
          setCountry(configData.country ?? "US");
          setMax(configData.max ?? 20);

          if (Array.isArray(platformsData.platforms)) {
            setPlatformsMeta(platformsData.platforms);
          }
        }
      } catch {
        if (!cancelled) setError("Could not load scheduled Apify configuration.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const addKeyword = () => {
    const trimmed = newKeyword.trim();
    if (trimmed && !keywords.includes(trimmed)) {
      setKeywords([...keywords, trimmed]);
      setNewKeyword("");
    }
  };

  const removeKeyword = (kw: string) => {
    setKeywords(keywords.filter((k) => k !== kw));
  };

  const togglePlatform = (id: string) => {
    if (selectedPlatforms.includes(id)) {
      if (selectedPlatforms.length > 1) {
        setSelectedPlatforms(selectedPlatforms.filter((p) => p !== id));
      }
    } else {
      setSelectedPlatforms([...selectedPlatforms, id]);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/apify/search-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          keywords,
          platforms: selectedPlatforms,
          location,
          country,
          max,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "could not save");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save configuration");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted py-4">
        <Loader2 className="size-4 animate-spin" /> Loading scheduled Apify settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-foreground flex items-center gap-2">
            <Zap className="size-4 text-brand" /> Scheduled Apify Scrapers
          </h2>
          <p className="text-sm text-faint">
            Runs multi-keyword searches automatically on your configured schedule tick.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((v) => !v)}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
            enabled ? "bg-brand" : "bg-border"
          )}
        >
          <span
            className={cn(
              "inline-block size-4 transform rounded-full bg-white shadow transition-transform",
              enabled ? "translate-x-6" : "translate-x-1"
            )}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-4 rounded-xl border border-border bg-surface/30 p-4">
          {/* Target Keywords */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
              Scheduled Keywords ({keywords.length})
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {keywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 rounded-md border border-brand/30 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand"
                >
                  {kw}
                  <button
                    type="button"
                    onClick={() => removeKeyword(kw)}
                    className="hover:text-foreground text-brand/70"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  placeholder="Add keyword…"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addKeyword();
                    }
                  }}
                  className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <button
                  type="button"
                  onClick={addKeyword}
                  disabled={!newKeyword.trim()}
                  className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-foreground hover:bg-secondary/80 disabled:opacity-50"
                >
                  <Plus className="size-3" />
                </button>
              </div>
            </div>
          </div>

          {/* Platforms */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
              Platforms
            </label>
            <div className="flex flex-wrap gap-2">
              {platformsMeta.map((p) => {
                const selected = selectedPlatforms.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePlatform(p.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                      selected
                        ? "border-brand bg-brand-soft text-brand"
                        : "border-border text-muted hover:text-foreground"
                    )}
                  >
                    <span>{p.label}</span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] uppercase font-bold",
                        p.cost === "rental"
                          ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                          : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                      )}
                    >
                      {p.cost}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Options */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Location</label>
              <input
                type="text"
                placeholder="e.g. Remote"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Country</label>
              <input
                type="text"
                placeholder="e.g. US"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Max items</label>
              <input
                type="number"
                min={1}
                max={100}
                value={max}
                onChange={(e) => setMax(Math.max(1, parseInt(e.target.value) || 20))}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-60 max-sm:min-h-[44px]"
      >
        {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
        {saving ? "Saving…" : saved ? "Saved" : "Save scheduled Apify settings"}
      </button>
    </div>
  );
}
