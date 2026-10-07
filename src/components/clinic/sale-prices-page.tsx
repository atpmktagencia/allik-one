import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";
import { PageHeader } from "./page-kit";

type SalePrice = { id: string; name: string; route: "IM" | "EV"; supplier: string; price: number };
type Payload = { prices: SalePrice[]; source: { file: string; importedAt: string } | null };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function SalePricesPage() {
  const query = useInventory<Payload>("sale-prices");
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Comercial"
        title="Vendas Realizadas"
        description="Tabela interna dos injetáveis mais utilizados pela clínica."
      />
      <Card>
        <CardHeader>
          <CardTitle>{data.prices.length} valores vigentes</CardTitle>
          <CardDescription>
            Fonte: {data.source?.file ?? "não informada"}. Confirme a tabela vigente antes de
            informar ao paciente.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-6 py-3">Ativo / protocolo</th>
                  <th className="px-4 py-3">Via</th>
                  <th className="px-4 py-3">Fornecedor</th>
                  <th className="px-6 py-3 text-right">Venda</th>
                </tr>
              </thead>
              <tbody>
                {data.prices.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="px-6 py-3 font-medium">{item.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{item.route}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{item.supplier}</td>
                    <td className="px-6 py-3 text-right font-semibold">
                      {money.format(item.price)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
