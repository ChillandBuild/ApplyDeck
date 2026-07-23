"use client";

import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type LogEntry = {
  timestamp: string;
  reportNum: string;
  company: string;
  verdict: string;
  reason: string;
  score: string;
  vendor: string;
  outcome: string;
};

const VERDICT_STYLE: Record<string, string> = {
  auto_submit: "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
  draft_only: "bg-surface-hover text-muted border-border",
  blocked: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
};

const REASON_LABELS: Record<string, string> = {
  ok: "cleared every check",
  tier_off: "auto-submit is off",
  below_threshold: "score too low",
  blacklisted: "company is on your Do Not Apply list",
  not_allowlisted: "company not on the allowlist",
  unsafe_vendor: "job board not in the allowed list",
  daily_cap: "hit today's submit limit",
  run_cap: "hit this run's submit limit",
};

export function AutomationActivityLog() {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/automation/log");
        const data = await res.json();
        setEntries(data.entries ?? []);
        setTotal(data.total ?? 0);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="mt-10 flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading activity…
      </div>
    );
  }

  return (
    <div className="mt-10 border-t border-border pt-8">
      <div className="mb-1 flex items-center gap-2">
        <History className="size-4 text-brand" />
        <h2 className="text-lg font-medium text-foreground">Automation Activity</h2>
      </div>
      <p className="mb-4 text-sm text-faint">
        {total === 0
          ? "No activity yet — this fills in once the automation has run at least once."
          : `Showing the ${Math.min(entries.length, total)} most recent of ${total} total.`}
      </p>
      {entries.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-hover text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Why</th>
                <th className="px-3 py-2">Score</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.timestamp}-${i}`} className="border-t border-border">
                  <td className="px-3 py-2 text-xs text-faint">{e.timestamp.replace("T", " ")}</td>
                  <td className="px-3 py-2">{e.company}</td>
                  <td className="px-3 py-2">
                    <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", VERDICT_STYLE[e.verdict] ?? "")}>
                      {e.outcome}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{REASON_LABELS[e.reason] ?? e.reason}</td>
                  <td className="px-3 py-2 text-xs">{e.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
