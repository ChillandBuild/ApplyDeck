"use client";

import { useEffect, useState } from "react";
import { Search, Loader2, Key, Play } from "lucide-react";
import { instrumentSerif } from "@/lib/fonts";
import { SearchSourcesCard } from "@/components/search-sources-card";
import { AiSearchBox } from "@/components/explore/ai-search-box";
import { useExplore } from "@/components/explore/explore-provider";
import { ResultsList } from "@/components/explore/results-list";
import { AiHuntView } from "@/components/explore/ai-hunt-view";
import type { DiscoveredOffer } from "@/lib/explore";

const CLI_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  copilot: "Copilot CLI",
  qwen: "Qwen CLI",
  antigravity: "Antigravity CLI",
};

export default function ScoutPage() {
  const { aiIntent, setAiIntent, discoverAI, running, phase, offers, error, status } = useExplore();
  const [cli, setCli] = useState<{ id: string | null; name?: string }>({ id: null });
  const [serperKeyConfigured, setSerperKeyConfigured] = useState(false);
  const [typedSerperKey, setTypedSerperKey] = useState("");
  const [serperSaving, setSerperSaving] = useState(false);
  const [serperError, setSerperError] = useState<string | null>(null);

  const [webRunning, setWebRunning] = useState(false);
  const [webOffers, setWebOffers] = useState<DiscoveredOffer[]>([]);
  const [webError, setWebError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const id = JSON.parse(localStorage.getItem("career-ops:config") || "{}").cliId || null;
      setCli({ id, name: id ? CLI_NAMES[id] || id : undefined });
    } catch {
      setCli({ id: null });
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/secrets/serper-key");
        const data = (await res.json()) as { configured: boolean };
        if (!cancelled) setSerperKeyConfigured(!!data.configured);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const saveSerperKey = async (val: string) => {
    setSerperSaving(true);
    setSerperError(null);
    try {
      const res = await fetch("/api/secrets/serper-key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: val }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "could not save key");
      }
      const data = await res.json();
      setSerperKeyConfigured(!!data.configured);
      setTypedSerperKey("");
    } catch (e) {
      setSerperError(e instanceof Error ? e.message : "could not save key");
    } finally {
      setSerperSaving(false);
    }
  };

  const runScheduledWebSearch = async () => {
    setWebRunning(true);
    setWebError(null);
    setWebOffers([]);
    const acc: DiscoveredOffer[] = [];
    try {
      const res = await fetch("/api/scout/web-search/run", { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "failed to start web search");
      }
      if (!res.body) throw new Error("no response stream");

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.kind === "offer" && ev.offer) {
              acc.push(ev.offer);
              setWebOffers([...acc]);
            } else if (ev.kind === "error") {
              setWebError(ev.message);
            }
          } catch {
            /* skip */
          }
        }
      }
    } catch (e) {
      setWebError(e instanceof Error ? e.message : "web search failed");
    } finally {
      setWebRunning(false);
    }
  };

  if (running) return <AiHuntView cliName={cli.name} />;

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8 space-y-8">
      <header>
        <div className="flex items-center gap-2.5">
          <Search className="size-6 text-brand" />
          <h1 className={`${instrumentSerif.className} text-3xl text-foreground`}>Scout</h1>
          <span className="rounded-full border border-brand/30 bg-brand-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-text">
            Web Search
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          The web-search discovery channel — both on-demand plain-language AI search (via your CLI agent) and scheduled headless site queries (via Serper API).
        </p>
      </header>

      {/* Section 1: On-Demand AI Search */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-6">
        <h2 className="text-lg font-medium text-foreground flex items-center gap-2">
          <span>🤖 On-Demand AI Search</span>
          <span className="text-xs font-normal text-muted">(CLI tokens)</span>
        </h2>

        <AiSearchBox
          intent={aiIntent}
          onIntent={setAiIntent}
          onSubmit={() => void discoverAI()}
          cliConfigured={!!cli.id}
          cliName={cli.name}
          onRunScan={() => {}}
        />

        {phase === "results" && <ResultsList offers={offers.map((o) => ({ ...o, inPipeline: false }))} />}
        {phase === "failed" && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-700 dark:text-amber-300">
            {error || status || "AI Search failed"}
          </div>
        )}
      </section>

      {/* Section 2: Scheduled Web Searches (Serper API) */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-foreground flex items-center gap-2">
            <span>🌐 Scheduled Web Searches</span>
            <span className="text-xs font-normal text-muted">(Headless / Serper Key)</span>
          </h2>
          <button
            type="button"
            onClick={runScheduledWebSearch}
            disabled={webRunning || !serperKeyConfigured}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-xs font-semibold text-brand-foreground hover:bg-brand/90 disabled:opacity-50 transition-colors"
          >
            {webRunning ? (
              <>
                <Loader2 className="size-3 animate-spin" /> Searching…
              </>
            ) : (
              <>
                <Play className="size-3 fill-current" /> Run Web Searches Now
              </>
            )}
          </button>
        </div>

        {/* Serper Key Field */}
        <div className="rounded-xl border border-border bg-surface/30 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground flex items-center gap-1.5">
              <Key className="size-3.5 text-brand" /> Serper API Key
            </span>
            <span className="text-faint">
              {serperKeyConfigured ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-500">
                  <span className="size-1.5 rounded-full bg-emerald-500" /> Key Configured{" "}
                  <button type="button" onClick={() => saveSerperKey("")} className="text-brand hover:underline">
                    (Clear)
                  </button>
                </span>
              ) : (
                "Required for scheduled 3am web scans"
              )}
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={typedSerperKey}
              onChange={(e) => setTypedSerperKey(e.target.value)}
              placeholder="Paste your Serper API key…"
              autoComplete="off"
              className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted"
            />
            <button
              type="button"
              onClick={() => typedSerperKey.trim() && saveSerperKey(typedSerperKey.trim())}
              disabled={serperSaving || !typedSerperKey.trim()}
              className="rounded-md bg-brand px-3.5 py-1.5 text-xs font-semibold text-brand-foreground disabled:opacity-50"
            >
              {serperSaving ? <Loader2 className="size-3 animate-spin" /> : "Save key"}
            </button>
          </div>
          {serperError && <p className="text-xs text-red-500">{serperError}</p>}
        </div>

        {webError && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            {webError}
          </div>
        )}

        {webOffers.length > 0 && <ResultsList offers={webOffers.map((o) => ({ ...o, inPipeline: false }))} />}

        <SearchSourcesCard />
      </section>
    </div>
  );
}
