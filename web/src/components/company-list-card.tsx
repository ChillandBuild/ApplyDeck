"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Plus, Trash2, Building2 } from "lucide-react";
import { cn } from "@/lib/cn";

type TrackedCompany = { name: string; careersUrl: string; vendor: string | null };

const VENDOR_LABELS: Record<string, string> = {
  greenhouse: "Greenhouse",
  ashby: "Ashby",
  lever: "Lever",
  workday: "Workday",
};

export function CompanyListCard() {
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<TrackedCompany[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/portals/snapshot");
    const data = await res.json();
    setCompanies(data.companies ?? []);
  };

  useEffect(() => {
    (async () => {
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const add = async () => {
    if (!name.trim() || !url.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/portals", {
        method: "PUT",
        body: JSON.stringify({ addCompany: { name: name.trim(), careersUrl: url.trim() } }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "could not add company");
      }
      setName("");
      setUrl("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not add company");
    } finally {
      setAdding(false);
    }
  };

  const remove = async (companyName: string) => {
    await fetch("/api/portals", { method: "PUT", body: JSON.stringify({ removeCompany: companyName }) });
    await load();
  };

  if (loading) {
    return (
      <div className="mt-10 flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading companies…
      </div>
    );
  }

  return (
    <div className="mt-10 border-t border-border pt-8">
      <div className="mb-1 flex items-center gap-2">
        <Building2 className="size-4 text-brand" />
        <h2 className="text-lg font-medium text-foreground">Companies to Scan</h2>
      </div>
      <p className="mb-4 text-sm text-faint">
        Paste a company's job-board link (Greenhouse, Ashby, Lever, or Workday) to start scanning it. Other job boards
        aren't supported here yet — ask your admin to add those.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Company name"
          className="w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm sm:w-40"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://job-boards.greenhouse.io/company"
          className="w-full flex-1 rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={add}
          disabled={adding}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground disabled:opacity-60",
          )}
        >
          {adding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Add
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <ul className="mt-4 space-y-1.5">
        {companies.map((c) => (
          <li key={c.name} className="flex items-center justify-between rounded-md border border-border bg-surface/30 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              {c.name}
              {c.vendor && (
                <span className="rounded-full border border-border bg-surface-hover px-2 py-0.5 text-xs text-muted">
                  {VENDOR_LABELS[c.vendor] ?? c.vendor}
                </span>
              )}
            </span>
            <button type="button" onClick={() => remove(c.name)} aria-label={`Remove ${c.name}`} className="text-muted hover:text-red-600">
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {companies.length === 0 && <li className="text-xs text-faint">No companies added here yet.</li>}
      </ul>
    </div>
  );
}
