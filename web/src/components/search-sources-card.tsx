"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/cn";

type SearchSource = { name: string; query: string; enabled: boolean };

export function SearchSourcesCard() {
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<SearchSource[]>([]);
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portals/snapshot");
        const data = (await res.json()) as { searchSources?: SearchSource[] };
        if (!cancelled) setSources(data.searchSources ?? []);
      } catch {
        if (!cancelled) setError("Could not load search sources — check the server is running.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (name: string, nextEnabled: boolean) => {
    setSources((cur) => cur.map((s) => (s.name === name ? { ...s, enabled: nextEnabled } : s)));
    setPending((cur) => new Set(cur).add(name));
    setError(null);
    try {
      const res = await fetch("/api/portals", {
        method: "PUT",
        body: JSON.stringify({ toggleSearchSource: { name, enabled: nextEnabled } }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "could not save");
      }
    } catch (e) {
      setSources((cur) => cur.map((s) => (s.name === name ? { ...s, enabled: !nextEnabled } : s))); // roll back
      setError(e instanceof Error ? e.message : "could not save — try again");
    } finally {
      setPending((cur) => {
        const next = new Set(cur);
        next.delete(name);
        return next;
      });
    }
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter((s) => s.name.toLowerCase().includes(q) || s.query.toLowerCase().includes(q));
  }, [sources, filter]);

  if (loading) {
    return (
      <div className="mt-10 flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading search sources…
      </div>
    );
  }

  if (sources.length === 0) {
    return null; // nothing configured yet — no empty card to confuse a fresh install
  }

  return (
    <div className="mt-10 border-t border-border pt-8">
      <div className="mb-1 flex items-center gap-2">
        <Search className="size-4 text-brand" />
        <h2 className="text-lg font-medium text-foreground">Search Sources</h2>
      </div>
      <p className="mb-4 text-sm text-faint">
        Each row is a free web search against one job board (LinkedIn, Glassdoor, Naukri, and others) — no API key
        needed. Turn a platform off to stop scanning it; the role keywords above still apply on top. To change what a
        source actually searches for, ask your AI assistant to edit it.
      </p>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by platform or keyword…"
        className="mb-3 w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm sm:w-72"
      />

      <ul className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
        {filtered.map((s) => (
          <li
            key={s.name}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface/30 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{s.name}</p>
              <p className="truncate text-xs text-faint">{s.query}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={s.enabled}
              aria-label={`${s.enabled ? "Disable" : "Enable"} ${s.name}`}
              disabled={pending.has(s.name)}
              onClick={() => toggle(s.name, !s.enabled)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
                s.enabled ? "bg-brand" : "bg-border",
              )}
            >
              <span
                className={cn(
                  "inline-block size-4 transform rounded-full bg-white shadow transition-transform",
                  s.enabled ? "translate-x-6" : "translate-x-1",
                )}
              />
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="text-xs text-faint">No search sources match "{filter}".</li>}
      </ul>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
