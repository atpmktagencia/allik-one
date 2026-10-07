import { useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  productCatalogInput,
  locationCatalogInput,
  type CatalogSnapshot,
} from "@/data/catalog-input";
import { useInventoryWrite } from "@/hooks/use-inventory-write";

export function CatalogForm({
  kind,
  initial,
  onClose,
  onSaved,
}: {
  kind: "products" | "locations";
  initial: CatalogSnapshot | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isProduct = kind === "products";
  const product = initial && "sku" in initial ? initial : null;
  const [values, setValues] = useState(() => ({
    name: initial?.name ?? "",
    sku: product?.sku ?? "",
    category: product?.category ?? "Material",
    unit: product?.unit ?? "un",
    minimum: product?.minimum ?? "0",
    active: initial?.active ?? true,
    reason: "",
  }));
  const [validation, setValidation] = useState("");
  const identity = useRef({
    operationId: crypto.randomUUID(),
    id: initial?.id ?? crypto.randomUUID(),
  });
  const write = useInventoryWrite(`catalog/${kind}`);
  const busy = write.pending || write.uncertain;
  const noun = isProduct ? "produto" : "local";
  const change = (key: keyof typeof values, value: string | boolean) =>
    setValues((v) => ({ ...v, [key]: value }));
  async function save(event: FormEvent) {
    event.preventDefault();
    const fields = { ...identity.current, name: values.name };
    const item = isProduct ? { category: values.category, minimum: values.minimum } : {};
    const input = initial
      ? {
          ...fields,
          ...item,
          action: "UPDATE",
          version: initial.version,
          active: values.active,
          reason: values.reason,
        }
      : {
          ...fields,
          ...item,
          action: "CREATE",
          ...(isProduct ? { sku: values.sku, unit: values.unit } : {}),
        };
    const parsed = isProduct
      ? productCatalogInput.safeParse(input)
      : locationCatalogInput.safeParse(input);
    if (!parsed.success) {
      setValidation(
        "Confira os campos. Use mínimo não negativo com até três casas decimais e motivo de edição com pelo menos 10 caracteres.",
      );
      return;
    }
    setValidation("");
    if (await write.submit(parsed.data)) onSaved();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? `Editar ${noun}` : `Novo ${noun}`}</DialogTitle>
          <DialogDescription>
            {initial
              ? "Informe o motivo para registrar a alteração no histórico."
              : "O cadastro fica disponível nas operações de estoque após salvar."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <fieldset disabled={busy} className="space-y-4">
            <label className="block space-y-1">
              <span>Nome do {noun}</span>
              <Input
                value={values.name}
                onChange={(e) => change("name", e.target.value)}
                required
                minLength={2}
                maxLength={isProduct ? 500 : 100}
              />
            </label>
            {isProduct && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1">
                    <span>SKU</span>
                    <Input
                      value={values.sku}
                      readOnly={Boolean(initial)}
                      onChange={(e) => change("sku", e.target.value)}
                      required
                      maxLength={64}
                      pattern="[a-zA-Z0-9._-]+"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span>Unidade</span>
                    <Input
                      value={values.unit}
                      readOnly={Boolean(initial)}
                      onChange={(e) => change("unit", e.target.value)}
                      required
                      maxLength={20}
                    />
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  SKU e unidade são definidos no cadastro e preservados nos lotes.
                </p>
                <label className="block space-y-1">
                  <span>Categoria</span>
                  <Input
                    value={values.category}
                    onChange={(e) => change("category", e.target.value)}
                    required
                    minLength={2}
                    maxLength={100}
                  />
                </label>
                <label className="block space-y-1">
                  <span>Estoque mínimo</span>
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    max="99999999999.999"
                    value={values.minimum}
                    onChange={(e) => change("minimum", e.target.value)}
                    required
                  />
                </label>
              </>
            )}
            {initial && (
              <>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={values.active}
                    onChange={(e) => change("active", e.target.checked)}
                  />
                  {isProduct ? "Produto ativo" : "Local ativo"}
                </label>
                <p className="text-xs text-muted-foreground">
                  Para desativar, o saldo físico deve estar zerado
                  {isProduct ? " e os pedidos devem estar recebidos" : ""}. O histórico continua
                  disponível.
                </p>
                <label className="block space-y-1">
                  <span>Motivo da alteração</span>
                  <Input
                    value={values.reason}
                    onChange={(e) => change("reason", e.target.value)}
                    required
                    minLength={10}
                    maxLength={500}
                  />
                </label>
              </>
            )}
          </fieldset>
          {(validation || write.error) && (
            <div role="alert" className="rounded-md border p-3 text-sm">
              {validation || write.error?.message}
              {write.error?.status === 401 && (
                <Link
                  className="ml-2 underline"
                  to="/estoque/acesso"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Fazer login
                </Link>
              )}
            </div>
          )}
          {write.uncertain && (
            <p role="status" className="text-sm text-muted-foreground">
              O resultado ainda não foi confirmado. Reenvie os mesmos dados para conferir sem
              duplicar a alteração.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" disabled={write.pending}>
              {write.pending
                ? "Salvando…"
                : write.uncertain
                  ? "Tentar novamente"
                  : `Salvar ${noun}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
