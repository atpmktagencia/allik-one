import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  Concluída: "bg-success-soft text-success-foreground",
  Pago: "bg-success-soft text-success-foreground",
  Regular: "bg-success-soft text-success-foreground",
  Confirmada: "bg-info-soft text-info-foreground",
  Ativa: "bg-info-soft text-info-foreground",
  "Em atendimento": "bg-warning-soft text-warning-foreground",
  Aguardando: "bg-muted text-muted-foreground",
  Parcelado: "bg-warning-soft text-warning-foreground",
  Reposição: "bg-danger-soft text-danger-foreground",
  Novo: "bg-accent text-accent-foreground",
  "Em tratamento": "bg-info-soft text-info-foreground",
};

export function StatusPill({ label }: { label: string }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium",
        styles[label] ?? "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}
