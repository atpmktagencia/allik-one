import { useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

/** Shared longitudinal frame; encounter steps belong to the task bar. */
export function ClinicalNavigation({ label, children }: { label: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <nav aria-label={label} data-collapsed={collapsed} className="clinical-navigation">
      <div className="mb-2 flex items-center justify-between gap-2 px-2">
        <span
          className={
            collapsed
              ? "sr-only"
              : "text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          }
        >
          Paciente360º
        </span>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-accent"
          aria-label={collapsed ? "Expandir navegação clínica" : "Recolher navegação clínica"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>
      <div className="clinical-navigation-items">{children}</div>
    </nav>
  );
}
