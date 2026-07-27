import Link from "next/link";
import { pipelineSummary } from "@/lib/career-ops";
import { canonStatus, scoreNum } from "@/lib/format";
import { runJsonScript } from "@/lib/core/run-json-script";

export const dynamic = "force-dynamic";

const STAGES: { key: string; label: string }[] = [
  { key: "EVALUATED", label: "Evaluated" },
  { key: "APPLIED", label: "Applied" },
  { key: "RESPONDED", label: "Responded" },
  { key: "INTERVIEW", label: "Interview" },
  { key: "OFFER", label: "Offer" },
  { key: "REJECTED", label: "Rejected" },
  { key: "DISCARDED", label: "Discarded" },
];

type UpskillGap = { skill: string; weightedScore: number; tier: "High" | "Medium" | "Low"; reports: number };
type UpskillResult = { gaps: UpskillGap[] };

type Recommendation = { action: string; reasoning: string; impact: "high" | "medium" | "low" };
type VendorRow = { vendor: string; total: number; advanceRate: number; sharePct: number; sufficientSample: boolean };
type TechGap = { skill: string; frequency: number };
type DiscardReason = { reason: string; frequency: number; percentage: number };
type PatternsResult =
  | { error: string; current: number; threshold: number }
  | {
      recommendations: Recommendation[];
      vendorAnalysis: { breakdown: VendorRow[]; minSampleForClaim: number };
      techStackGaps: TechGap[];
      discardReasonStats: DiscardReason[];
    };

export default async function Analytics() {
  const { applications } = pipelineSummary();
  const total = applications.length;

  const [upskill, patterns] = await Promise.all([
    runJsonScript<UpskillResult>("upskill"),
    runJsonScript<PatternsResult>("analyze-patterns"),
  ]);
  const gaps = (upskill?.gaps ?? []).slice(0, 10);
  const maxGap = Math.max(1, ...gaps.map((g) => g.weightedScore));
  const patternsAvailable = patterns && !("error" in patterns);
  const recommendations = patternsAvailable ? patterns.recommendations : [];
  const vendorRows = patternsAvailable ? patterns.vendorAnalysis.breakdown : [];
  const maxVendor = Math.max(1, ...vendorRows.map((v) => v.total));
  const techGaps = (patternsAvailable ? patterns.techStackGaps : []).slice(0, 10);
  const maxTechGap = Math.max(1, ...techGaps.map((t) => t.frequency));
  const discardReasons = patternsAvailable ? patterns.discardReasonStats : [];
  const maxDiscard = Math.max(1, ...discardReasons.map((d) => d.frequency));

  const stageCounts = STAGES.map((s) => ({
    ...s,
    n: applications.filter((a) => canonStatus(a.status).includes(s.key)).length,
  }));
  const maxStage = Math.max(1, ...stageCounts.map((s) => s.n));

  const scores = applications.map((a) => scoreNum(a.score)).filter((n) => !Number.isNaN(n));
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const buckets = [
    { label: "4.5 – 5.0", test: (n: number) => n >= 4.5 },
    { label: "4.0 – 4.4", test: (n: number) => n >= 4 && n < 4.5 },
    { label: "3.0 – 3.9", test: (n: number) => n >= 3 && n < 4 },
    { label: "< 3.0", test: (n: number) => n < 3 },
  ].map((b) => ({ label: b.label, n: scores.filter(b.test).length }));
  const maxBucket = Math.max(1, ...buckets.map((b) => b.n));

  const companyCounts = new Map<string, number>();
  for (const a of applications) if (a.company) companyCounts.set(a.company, (companyCounts.get(a.company) ?? 0) + 1);
  const topCompanies = [...companyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxCompany = Math.max(1, ...topCompanies.map((c) => c[1]));

  const offers = stageCounts.find((s) => s.key === "OFFER")?.n ?? 0;
  const interviews = stageCounts.find((s) => s.key === "INTERVIEW")?.n ?? 0;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="font-display text-2xl tracking-tight text-landing">Analytics</h1>
      <p className="mt-1 text-sm text-muted">Across {total} tracked evaluations.</p>

      {/* headline stats */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat value={total} label="evaluated" />
        <Stat value={avg ? avg.toFixed(2) : "—"} label="avg score" />
        <Stat
          value={interviews}
          label="interviews"
          hint={interviews === 0 ? "Interviews follow replies — keep follow-ups warm →" : undefined}
        />
        <Stat
          value={offers}
          label="offers"
          hint={offers === 0 ? "Offers follow interviews — keep the conversations going →" : undefined}
        />
      </div>

      <Section title="Pipeline by stage">
        {stageCounts.map((s) => (
          <Bar
            key={s.key}
            label={s.label}
            value={s.n}
            pct={(s.n / maxStage) * 100}
            total={total}
            tone={s.key === "OFFER" ? "positive" : "neutral"}
          />
        ))}
      </Section>

      <Section title="Score distribution">
        {buckets.map((b) => (
          <Bar key={b.label} label={b.label} value={b.n} pct={(b.n / maxBucket) * 100} total={scores.length} />
        ))}
      </Section>

      <Section title="Top companies" id="companies">
        {topCompanies.map(([name, n]) => (
          <Bar key={name} label={name} value={n} pct={(n / maxCompany) * 100} />
        ))}
      </Section>

      <Section title="Skill gaps" id="skill-gaps">
        {gaps.length > 0 ? (
          gaps.map((g) => (
            <Bar
              key={g.skill}
              label={g.skill}
              value={g.weightedScore}
              pct={(g.weightedScore / maxGap) * 100}
              tone={g.tier === "High" ? "positive" : "neutral"}
            />
          ))
        ) : (
          <p className="text-sm text-faint">Not enough low-fit reports yet to spot a pattern — keep evaluating roles.</p>
        )}
      </Section>

      <Section title="Advance rate by job board" id="advance-rate">
        {!patterns ? (
          <p className="text-sm text-faint">Not available — run `node analyze-patterns.mjs` to check.</p>
        ) : !patternsAvailable ? (
          <p className="text-sm text-faint">
            {patterns.error} ({patterns.current}/{patterns.threshold})
          </p>
        ) : vendorRows.length === 0 ? (
          <p className="text-sm text-faint">No identified ATS vendors in the tracker yet.</p>
        ) : (
          <>
            {vendorRows.map((v) => (
              <Bar
                key={v.vendor}
                label={v.sufficientSample ? v.vendor : `${v.vendor} (n=${v.total})`}
                value={v.advanceRate}
                pct={(v.total / maxVendor) * 100}
              />
            ))}
            {recommendations.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-border pt-4">
                {recommendations.map((r, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium text-foreground">{r.action}</span>
                    <span className="block text-xs text-faint">{r.reasoning}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Section>

      <Section title="Tech stack gaps" id="tech-stack-gaps">
        {!patterns ? (
          <p className="text-sm text-faint">Not available — run `node analyze-patterns.mjs` to check.</p>
        ) : !patternsAvailable ? (
          <p className="text-sm text-faint">
            {patterns.error} ({patterns.current}/{patterns.threshold})
          </p>
        ) : techGaps.length === 0 ? (
          <p className="text-sm text-faint">No recurring tech-stack mismatch found in your negative/self-filtered reports yet.</p>
        ) : (
          techGaps.map((t) => <Bar key={t.skill} label={t.skill} value={t.frequency} pct={(t.frequency / maxTechGap) * 100} />)
        )}
      </Section>

      <Section title="Discard reasons" id="discard-reasons">
        {!patterns ? (
          <p className="text-sm text-faint">Not available — run `node analyze-patterns.mjs` to check.</p>
        ) : !patternsAvailable ? (
          <p className="text-sm text-faint">
            {patterns.error} ({patterns.current}/{patterns.threshold})
          </p>
        ) : discardReasons.length === 0 ? (
          <p className="text-sm text-faint">No self-filtered discards logged yet.</p>
        ) : (
          discardReasons.map((d) => <Bar key={d.reason} label={d.reason} value={d.frequency} pct={(d.frequency / maxDiscard) * 100} />)
        )}
      </Section>
    </div>
  );
}

function Stat({ value, label, hint }: { value: number | string; label: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface/50 p-4">
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-faint">{label}</div>
      {hint && (
        <Link href="/" className="mt-2 block text-xs text-muted transition-colors hover:text-brand">
          {hint}
        </Link>
      )}
    </div>
  );
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="mt-10 scroll-mt-8">
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">{title}</h2>
      <div className="mt-4 space-y-2.5">{children}</div>
    </section>
  );
}

function Bar({
  label,
  value,
  pct,
  total,
  tone = "neutral",
}: {
  label: string;
  value: number;
  pct: number;
  total?: number;
  tone?: "neutral" | "positive";
}) {
  const share = total && total > 0 ? Math.round((value / total) * 100) : null;
  const fill =
    tone === "positive"
      ? "bg-gradient-to-r from-emerald-500/60 to-emerald-500/30"
      : "bg-gradient-to-r from-foreground/25 to-foreground/10";
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 shrink-0 truncate text-sm text-muted">{label}</div>
      <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-surface">
        <div
          className={`h-full rounded-md ${fill}`}
          style={{ width: `${Math.max(pct, value > 0 ? 4 : 0)}%` }}
        />
      </div>
      <div className="w-20 shrink-0 text-right text-sm tabular-nums">
        {value}
        {share !== null && <span className="ml-1 text-xs text-faint">{share}%</span>}
      </div>
    </div>
  );
}
