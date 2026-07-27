import { CalendarClock } from "lucide-react";
import { runJsonScript } from "@/lib/core/run-json-script";
import { FollowUpCard, type FollowUp } from "@/components/home/follow-up-card";

export const dynamic = "force-dynamic";

type Entry = FollowUp & { urgency: "overdue" | "urgent" | "waiting" | "cold"; nextFollowupDate?: string | null };
type FollowupResult =
  | { error: string }
  | { metadata: { totalTracked: number; overdue: number; urgent: number; waiting: number; cold: number }; entries: Entry[] };

const GROUPS: { key: Entry["urgency"]; title: string; hint: string }[] = [
  { key: "overdue", title: "Overdue", hint: "Past the usual window — worth a nudge now." },
  { key: "urgent", title: "Urgent", hint: "Due very soon (e.g. an interview thank-you note)." },
  { key: "waiting", title: "On track", hint: "Not due yet — nothing to do." },
  { key: "cold", title: "No further follow-up", hint: "Already followed up the max number of times." },
];

export default async function FollowupsPage() {
  const result = await runJsonScript<FollowupResult>("followup-cadence");
  const available = result && !("error" in result);
  const entries = available ? result.entries : [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-display text-2xl tracking-tight text-landing">Follow-ups</h1>
      <p className="mt-1 text-sm text-muted">
        {!result
          ? "Follow-up cadence not available."
          : !available
            ? result.error
            : `${result.metadata.totalTracked} applications tracked for follow-up.`}
      </p>

      {entries.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface/30 py-16 text-center">
          <CalendarClock className="size-8 text-faint" />
          <p className="text-sm text-muted">Nothing needs a follow-up right now.</p>
        </div>
      ) : (
        GROUPS.map((g) => {
          const rows = entries.filter((e) => e.urgency === g.key);
          if (rows.length === 0) return null;
          return (
            <section key={g.key} className="mt-8 first:mt-6">
              <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                {g.title} <span className="ml-1 normal-case tracking-normal text-faint">({rows.length})</span>
              </h2>
              <p className="mt-1 text-xs text-faint">{g.hint}</p>
              <div className="mt-3 space-y-2">
                {rows.map((e) => (
                  <FollowUpCard key={e.num ?? `${e.company}-${e.role}`} followup={e} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
