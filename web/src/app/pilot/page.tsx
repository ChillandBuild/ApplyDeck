import { Bot } from "lucide-react";
import { instrumentSerif } from "@/lib/fonts";
import { TargetingCard } from "@/components/targeting-card";
import { AutomationSafetyCard } from "@/components/automation-safety-card";
import { AutomationActivityLog } from "@/components/automation-activity-log";

export const metadata = {
  title: "Pilot — Automation Cockpit | ApplyDeck",
  description: "Configure automated job discovery, standing instructions, and safety guardrails.",
};

export default function PilotPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8 space-y-8">
      <header>
        <div className="flex items-center gap-2.5">
          <Bot className="size-6 text-brand" />
          <h1 className={`${instrumentSerif.className} text-3xl text-foreground`}>Pilot</h1>
          <span className="rounded-full border border-brand/30 bg-brand-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-text">
            Automation Cockpit
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          Your standing instruction set for unattended discovery and safety policies. Pilot manages background job hunting, schedule intervals, and auto-submit guardrails.
        </p>
      </header>

      {/* Section 1: Job Targeting & Schedules */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <TargetingCard />
      </section>

      {/* Section 2: Automation Safety Guardrails */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <AutomationSafetyCard />
      </section>

      {/* Section 3: Activity Audit Log */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <AutomationActivityLog />
      </section>
    </div>
  );
}
