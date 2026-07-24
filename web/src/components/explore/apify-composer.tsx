"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, X, AlertTriangle, Play } from "lucide-react";
import { cn } from "@/lib/cn";

export type ApifyPlatformMeta = { id: string; label: string; cost: "usage" | "rental" };

export type ApifyComposerParams = {
  keywords: string[];
  platforms: string[];
  location: string;
  country: string;
  max: number;
};

export function ApifyComposer({
  onRun,
  running,
}: {
  onRun: (params: ApifyComposerParams) => void;
  running: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [platformsMeta, setPlatformsMeta] = useState<ApifyPlatformMeta[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["indeed"]);
  const [location, setLocation] = useState("");
  const [country, setCountry] = useState("US");
  const [max, setMax] = useState(20);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [metaRes, snapshotRes] = await Promise.all([
          fetch("/api/apify/platforms"),
          fetch("/api/portals/snapshot"),
        ]);
        const metaData = (await metaRes.json()) as { platforms?: ApifyPlatformMeta[] };
        const snapshotData = (await snapshotRes.json()) as { positive?: string[]; alwaysAllow?: string[] };

        if (!cancelled) {
          if (Array.isArray(metaData.platforms)) {
            setPlatformsMeta(metaData.platforms);
          }
          if (Array.isArray(snapshotData.positive) && snapshotData.positive.length > 0) {
            setKeywords(snapshotData.positive.slice(0, 3)); // seed top 3 keywords
          } else {
            setKeywords(["Software Engineer"]);
          }
          if (Array.isArray(snapshotData.alwaysAllow) && snapshotData.alwaysAllow.length > 0) {
            setLocation(snapshotData.alwaysAllow[0]);
          }
        }
      } catch {
        if (!cancelled) {
          setPlatformsMeta([
            { id: "indeed", label: "Indeed", cost: "usage" },
            { id: "linkedin", label: "LinkedIn", cost: "rental" },
            { id: "glassdoor", label: "Glassdoor", cost: "usage" },
            { id: "naukri", label: "Naukri", cost: "usage" },
          ]);
          setKeywords(["Software Engineer"]);
        }
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

  const fanout = keywords.length * selectedPlatforms.length;
  const hasRental = selectedPlatforms.some(
    (id) => platformsMeta.find((p) => p.id === id)?.cost === "rental"
  );

  const handleStart = () => {
    if (keywords.length === 0 || selectedPlatforms.length === 0) return;
    if (hasRental || fanout > 4) {
      setShowConfirm(true);
    } else {
      executeRun();
    }
  };

  const executeRun = () => {
    setShowConfirm(false);
    onRun({
      keywords,
      platforms: selectedPlatforms,
      location,
      country,
      max,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted p-4">
        <Loader2 className="size-3.5 animate-spin" /> Loading Apify composer metadata…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4 shadow-sm">
      {/* Target Keywords */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted">
          Target Keywords ({keywords.length})
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
                disabled={running}
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
              disabled={running}
              className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <button
              type="button"
              onClick={addKeyword}
              disabled={running || !newKeyword.trim()}
              className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-foreground hover:bg-secondary/80 disabled:opacity-50"
            >
              <Plus className="size-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Target Platforms */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted">
          Scraper Platforms
        </label>
        <div className="flex flex-wrap gap-2">
          {platformsMeta.map((p) => {
            const selected = selectedPlatforms.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => togglePlatform(p.id)}
                disabled={running}
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
                  title={
                    p.cost === "rental"
                      ? "Requires paid monthly rental subscription on Apify"
                      : "Standard usage-based credits"
                  }
                >
                  {p.cost}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Location, Country, and Max Items */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium text-muted block mb-1">Location</label>
          <input
            type="text"
            placeholder="e.g. Remote or San Francisco"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={running}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted block mb-1">Country</label>
          <input
            type="text"
            placeholder="e.g. US, IN, DE"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            disabled={running}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted block mb-1">Max items / search</label>
          <input
            type="number"
            min={1}
            max={100}
            value={max}
            onChange={(e) => setMax(Math.max(1, parseInt(e.target.value) || 20))}
            disabled={running}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
      </div>

      {/* Fanout Summary & Run Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
        <div className="text-xs text-muted">
          Fan-out estimate:{" "}
          <span className="font-semibold text-foreground">
            {keywords.length} keywords × {selectedPlatforms.length} platforms = {fanout} actor runs
          </span>
        </div>
        <button
          type="button"
          onClick={handleStart}
          disabled={running || keywords.length === 0 || selectedPlatforms.length === 0}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-brand-foreground hover:bg-brand/90 disabled:opacity-50 transition-colors"
        >
          {running ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Scraping…
            </>
          ) : (
            <>
              <Play className="size-3.5 fill-current" /> Run Apify Composer
            </>
          )}
        </button>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4 shadow-lg">
            <div className="flex items-center gap-2 text-amber-500 font-semibold text-sm">
              <AlertTriangle className="size-4" /> Confirm Apify Scraper Run
            </div>
            <div className="text-xs text-muted space-y-2">
              <p>
                You are about to launch <strong>{fanout} actor runs</strong> ({keywords.length}{" "}
                keywords across {selectedPlatforms.length} platforms).
              </p>
              {hasRental && (
                <p className="text-amber-500/90 bg-amber-500/10 p-2.5 rounded-md border border-amber-500/20">
                  ⚠️ <strong>LinkedIn actor included:</strong> LinkedIn scrapers on Apify often require a paid monthly rental subscription.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeRun}
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground hover:bg-brand/90"
              >
                Confirm & Run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
