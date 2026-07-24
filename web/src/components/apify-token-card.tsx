"use client";

import { useEffect, useState } from "react";
import { Loader2, KeyRound } from "lucide-react";

export function ApifyTokenCard() {
  const [apifyTokenConfigured, setApifyTokenConfigured] = useState(false);
  const [typedApifyToken, setTypedApifyToken] = useState("");
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/secrets/apify-token");
        const data = (await res.json()) as { configured: boolean };
        if (!cancelled) setApifyTokenConfigured(!!data.configured);
      } catch {
        /* ignore */
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
        headers: { "Content-Type": "application/json" },
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

  return (
    <div className="mt-8 border-t border-border pt-8 space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-brand" />
        <h2 className="text-lg font-medium text-foreground">Apify API Token</h2>
      </div>
      <p className="text-xs text-faint">
        Your token is used for paid scraper runs on Apify (Indeed, LinkedIn, Glassdoor, Naukri). Stored locally in this instance&apos;s <code className="font-mono text-[11px]">.env</code> file.
      </p>

      <div className="rounded-xl border border-border bg-surface/30 p-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted font-medium">Apify Token Status</span>
          <span className="text-faint">
            {apifyTokenConfigured ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-500">
                <span className="size-1.5 rounded-full bg-emerald-500" /> Token Configured{" "}
                <button type="button" onClick={() => saveToken("")} className="text-brand hover:underline">
                  (Clear)
                </button>
              </span>
            ) : (
              "Using shared token"
            )}
          </span>
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={typedApifyToken}
            onChange={(e) => setTypedApifyToken(e.target.value)}
            onBlur={() => typedApifyToken.trim() && saveToken(typedApifyToken.trim())}
            placeholder="Paste your Apify API token…"
            autoComplete="off"
            className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted"
          />
          <button
            type="button"
            onClick={() => typedApifyToken.trim() && saveToken(typedApifyToken.trim())}
            disabled={tokenSaving || !typedApifyToken.trim()}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground disabled:opacity-50"
          >
            {tokenSaving ? <Loader2 className="size-3 animate-spin" /> : "Save token"}
          </button>
        </div>
        {tokenError && <p className="text-xs text-red-500">{tokenError}</p>}
      </div>
    </div>
  );
}
