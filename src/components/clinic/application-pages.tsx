import { useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  useInventory,
  formatExpiry,
  type InventoryPosition,
  type InventoryProduct,
} from "@/data/inventory-api";
import { applicationInput } from "@/data/application-input";
import { fefoPositions, type InventoryApplication } from "@/data/application-api";
import { applicationPatients } from "@/data/mock-clinic";
import { useInventoryWrite } from "@/hooks/use-inventory-write";
import { InventoryState } from "./inventory-state";
import { SectionHeader } from "./section-header";

const selectClass = "block h-10 w-full rounded-md border bg-background px-3";
const patientName = (id: string) =>
  applicationPatients.find((patient) => patient.id === id)?.name ?? "Paciente sintético";
type Line = { key: number; productId: string; lotId: string; quantity: string };
const emptyLine = (key: number): Line => ({ key, productId: "", lotId: "", quantity: "" });

export function ApplicationsPage() {
  const query = useInventory<InventoryApplication[]>("applications");
  const [search, setSearch] = useState("");
  const filtered = (query.data ?? []).filter((application) =>
    `${application.reference} ${patientName(application.patientRef)} ${application.service} ${application.professional} ${application.items.map((item) => `${item.product} ${item.lot}`).join(" ")}`
      .toLocaleLowerCase("pt-BR")
      .includes(search.toLocaleLowerCase("pt-BR")),
  );
  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Operação · Aplicações"
        title="Aplicações"
        description="Aplicações diretas de demonstração, com consumo de estoque e histórico persistidos."
        action={
          <Button asChild>
            <Link to="/aplicacoes/nova">Nova aplicação</Link>
          </Button>
        }
      />
      <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        Pacientes sintéticos. Cada aplicação concluída registra a saída do lote e sua auditoria.
      </p>
      {query.isPending ? (
        <InventoryState pending />
      ) : query.error ? (
        <InventoryState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <label className="block space-y-2">
            Buscar aplicações
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Referência, paciente, serviço, executor ou lote"
            />
          </label>
          <div className="overflow-x-auto rounded-xl border bg-card shadow-soft">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  {[
                    "Data / referência",
                    "Paciente",
                    "Serviço",
                    "Profissional executor",
                    "Produto / lote",
                    "Local",
                    "Status",
                  ].map((title) => (
                    <th key={title} className="px-4 py-3 font-medium">
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((application) => (
                  <tr key={application.id} className="border-t">
                    <td className="px-4 py-4">
                      <p className="text-xs text-muted-foreground">
                        {new Date(application.createdAt).toLocaleString("pt-BR", {
                          timeZone: "America/Fortaleza",
                        })}
                      </p>
                      <p className="font-medium">{application.reference}</p>
                    </td>
                    <td className="px-4 py-4">{patientName(application.patientRef)}</td>
                    <td className="px-4 py-4">{application.service}</td>
                    <td className="px-4 py-4">{application.professional}</td>
                    <td className="px-4 py-4">
                      {application.items.map((item) => (
                        <p key={item.movementId}>
                          <span>
                            {item.product} · {item.lot} · {item.quantity} {item.unit}
                          </span>
                          <Link
                            to="/estoque/lotes/$lotId"
                            params={{ lotId: item.lotId }}
                            className="ml-2 underline"
                            aria-label={`Rastrear lote ${item.lot}`}
                          >
                            Rastrear lote
                          </Link>
                        </p>
                      ))}
                    </td>
                    <td className="px-4 py-4">{application.location}</td>
                    <td className="px-4 py-4">
                      <Badge variant="outline">Concluída</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p className="p-8 text-center text-muted-foreground">
                {query.data.length === 0
                  ? "Nenhuma aplicação registrada. Selecione “Nova aplicação” para começar."
                  : "Nenhuma aplicação encontrada para esta busca."}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function NewApplicationPage() {
  const stock = useInventory<InventoryPosition[]>("stock");
  const products = useInventory<InventoryProduct[]>("products");
  const locations = useInventory<{ id: string; name: string }[]>("locations");
  const refresh = () => {
    void stock.refetch();
    void products.refetch();
    void locations.refetch();
  };
  return (
    <div className="space-y-7">
      <SectionHeader
        eyebrow="Operação · Aplicação"
        title="Nova aplicação"
        description="Registre uma aplicação direta sintética. A confirmação baixa o estoque do local selecionado."
        action={
          <Button asChild variant="outline">
            <Link to="/aplicacoes">Voltar às aplicações</Link>
          </Button>
        }
      />
      {stock.isPending || products.isPending || locations.isPending ? (
        <InventoryState pending />
      ) : stock.error || products.error || locations.error ? (
        <InventoryState error={stock.error ?? products.error ?? locations.error} retry={refresh} />
      ) : (
        <ApplicationForm
          stock={stock.data}
          products={products.data}
          locations={locations.data}
          refresh={refresh}
        />
      )}
    </div>
  );
}

function ApplicationForm({
  stock,
  products,
  locations,
  refresh,
}: {
  stock: InventoryPosition[];
  products: InventoryProduct[];
  locations: { id: string; name: string }[];
  refresh: () => void;
}) {
  const write = useInventoryWrite("applications");
  const nextKey = useRef(1);
  const [lines, setLines] = useState<Line[]>([emptyLine(0)]);
  const [patientRef, setPatientRef] = useState("");
  const [service, setService] = useState("");
  const [professional, setProfessional] = useState("");
  const [reference, setReference] = useState("");
  const [locationId, setLocationId] = useState("");
  const [validation, setValidation] = useState("");
  const [savedReference, setSavedReference] = useState("");
  const selectableProducts = products.filter(
    (product) => product.active && product.stockControlled,
  );
  function changeLine(key: number, update: Partial<Line>) {
    setLines((previous) =>
      previous.map((line) => (line.key === key ? { ...line, ...update } : line)),
    );
  }
  async function register(body: unknown) {
    if (await write.submit(body)) {
      setSavedReference(reference);
      setLines([emptyLine(nextKey.current++)]);
      setReference("");
      setValidation("");
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSavedReference("");
    if (write.uncertain) {
      await register(undefined);
      return;
    }
    const parsed = applicationInput.safeParse({
      operationId: crypto.randomUUID(),
      patientRef,
      service,
      professional,
      reference,
      locationId,
      items: lines.map(({ productId, lotId, quantity }) => ({ productId, lotId, quantity })),
    });
    if (!parsed.success) {
      setValidation(
        "Confira os dados e informe quantidades positivas, com até três casas decimais, sem repetir lotes.",
      );
      return;
    }
    setValidation("");
    await register(parsed.data);
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        Demonstração sintética. O horário da confirmação será registrado automaticamente. Origem do
        consumo: aplicação direta.
      </p>
      {savedReference && (
        <div role="status" className="rounded-xl border bg-card p-4">
          Aplicação {savedReference} concluída. Estoque e histórico atualizados.{" "}
          <Link to="/aplicacoes" className="underline">
            Ver aplicações
          </Link>
        </div>
      )}
      {validation && <p role="alert">{validation}</p>}
      {write.error && (
        <div role="alert" className="rounded-xl border bg-card p-4">
          {write.error.message}
          {write.error.status === 401 && (
            <Link to="/estoque/acesso" className="ml-2 underline">
              Fazer login
            </Link>
          )}
          {write.error.status === 409 && (
            <Button type="button" variant="outline" className="ml-2" onClick={refresh}>
              Atualizar estoque
            </Button>
          )}
          {write.uncertain && <p>Reenvie os mesmos dados para confirmar sem duplicar o consumo.</p>}
        </div>
      )}
      <fieldset disabled={write.pending || write.uncertain} className="space-y-5">
        <div className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-2">
          <label className="space-y-2">
            Paciente sintético
            <select
              required
              className={selectClass}
              value={patientRef}
              onChange={(e) => setPatientRef(e.target.value)}
            >
              <option value="">Selecione</option>
              {applicationPatients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            Referência da aplicação
            <Input
              required
              maxLength={100}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Ex.: AP-104"
            />
          </label>
          <label className="space-y-2">
            Serviço / procedimento
            <Input
              required
              minLength={3}
              maxLength={100}
              value={service}
              onChange={(e) => setService(e.target.value)}
            />
          </label>
          <label className="space-y-2">
            Profissional executor
            <Input
              required
              minLength={3}
              maxLength={100}
              value={professional}
              onChange={(e) => setProfessional(e.target.value)}
            />
          </label>
          <label className="space-y-2 md:col-span-2">
            Local do consumo
            <select
              required
              className={selectClass}
              value={locationId}
              onChange={(e) => {
                const next = e.target.value;
                setLocationId(next);
                setLines((previous) =>
                  previous.map((line) => ({
                    ...line,
                    lotId: fefoPositions(stock, line.productId, next)[0]?.lotId ?? "",
                  })),
                );
              }}
            >
              <option value="">Selecione</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Produtos e lotes consumidos</h2>
          <p className="text-sm text-muted-foreground">
            FEFO sugere o lote disponível com vencimento mais próximo neste local. Confira o lote
            físico utilizado e a quantidade antes de confirmar.
          </p>
          {lines.map((line, index) => {
            const choices = fefoPositions(stock, line.productId, locationId);
            const selected = choices.find((position) => position.lotId === line.lotId);
            return (
              <div key={line.key} className="space-y-3 rounded-lg border p-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="space-y-2">
                    Produto consumido {index + 1}
                    <select
                      required
                      className={selectClass}
                      value={line.productId}
                      onChange={(e) =>
                        changeLine(line.key, {
                          productId: e.target.value,
                          lotId: fefoPositions(stock, e.target.value, locationId)[0]?.lotId ?? "",
                          quantity: "",
                        })
                      }
                    >
                      <option value="">Selecione</option>
                      {selectableProducts.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2">
                    Lote consumido {index + 1}
                    <select
                      required
                      className={selectClass}
                      value={line.lotId}
                      onChange={(e) => changeLine(line.key, { lotId: e.target.value })}
                    >
                      <option value="">Selecione</option>
                      {choices.map((position, i) => (
                        <option key={position.lotId} value={position.lotId}>
                          {position.lot} · vence {formatExpiry(position.expiry)}
                          {i === 0 ? " · FEFO" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2">
                    Quantidade consumida {index + 1}
                    <Input
                      required
                      type="number"
                      min="0.001"
                      step="0.001"
                      max={selected?.quantity}
                      value={line.quantity}
                      onChange={(e) => changeLine(line.key, { quantity: e.target.value })}
                    />
                  </label>
                </div>
                {selected && (
                  <p className="text-sm text-muted-foreground">
                    Saldo disponível: {selected.quantity} {selected.unit}.{" "}
                    {selected.lotId !== choices[0]?.lotId &&
                      "O lote escolhido não é o primeiro sugerido por validade. Confira o lote físico utilizado."}
                  </p>
                )}
                {line.productId && locationId && choices.length === 0 && (
                  <p role="status">
                    Sem lote disponível neste local para este produto. Receba ou transfira estoque
                    antes de confirmar.
                  </p>
                )}
                {lines.length > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setLines((previous) => previous.filter((item) => item.key !== line.key))
                    }
                  >
                    Remover item {index + 1}
                  </Button>
                )}
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            disabled={lines.length >= 20}
            onClick={() => setLines((previous) => [...previous, emptyLine(nextKey.current++)])}
          >
            Adicionar produto
          </Button>
        </div>
      </fieldset>
      <p className="text-sm text-muted-foreground">
        A confirmação registra todos os consumos juntos e valida novamente validade, disponibilidade
        e saldo no servidor.
      </p>
      <Button type="submit" disabled={write.pending}>
        {write.pending
          ? "Confirmando…"
          : write.uncertain
            ? "Reenviar aplicação"
            : "Confirmar aplicação"}
      </Button>
    </form>
  );
}
