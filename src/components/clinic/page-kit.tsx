import type { LucideIcon } from "lucide-react";
import { CircleDotDashed } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div>{eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">{eyebrow}</p>}<h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">{title}</h1>{description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}</div>
    {action}
  </div>;
}

export function PreviewNotice() {
  return <div className="flex items-center gap-2 text-xs text-muted-foreground"><CircleDotDashed className="size-3.5" /><span>Prévia visual — backend ainda não conectado</span></div>;
}

export function Section({ title, description, action, children, className }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={cn("rounded-lg border border-border bg-card shadow-soft", className)}>
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4"><div><h2 className="font-display text-base font-semibold text-card-foreground">{title}</h2>{description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}</div>{action}</div>
    <div className="p-5">{children}</div>
  </section>;
}

export function MetricCard({ label, value, detail, icon: Icon, tone = "primary" }: { label: string; value: string; detail: string; icon: LucideIcon; tone?: "primary" | "success" | "warning" | "neutral" }) {
  return <div className="rounded-lg border border-border bg-card p-5 shadow-soft">
    <div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">{label}</p><div className={cn("flex size-9 items-center justify-center rounded-md", tone === "primary" && "bg-info-soft text-info-foreground", tone === "success" && "bg-success-soft text-success-foreground", tone === "warning" && "bg-warning-soft text-warning-foreground", tone === "neutral" && "bg-muted text-muted-foreground")}><Icon className="size-4" /></div></div>
    <p className="mt-4 font-display text-2xl font-semibold text-card-foreground">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p>
  </div>;
}

export function EmptyPreview({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return <div className="flex min-h-44 flex-col items-center justify-center text-center"><div className="mb-3 flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon className="size-5" /></div><p className="font-medium text-foreground">{title}</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">{text}</p></div>;
}
