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
  supplierProfileInput,
  supplierCatalogInput,
  type SupplierProfile,
  type SupplierCatalogItem,
} from "@/data/supplier-input";
import { useInventoryWrite } from "@/hooks/use-inventory-write";

export function SupplierForm({
  supplier,
  item,
  kind,
  onClose,
  onSaved,
}: {
  supplier: SupplierProfile | null;
  item?: SupplierCatalogItem | null;
  kind: "supplier" | "item";
  onClose: () => void;
  onSaved: () => void;
}) {
  const entry = kind === "item";
  const initial = entry ? item : supplier;
  const [values, setValues] = useState(() => ({
    name: initial?.name ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    active: initial?.active ?? true,
    reason: "",
    code: item?.code ?? "",
    supplierSku: item?.supplierSku ?? "",
    kind: item?.kind ?? "PRODUCT",
    description: item?.description ?? "",
    packaging: item?.packaging ?? "Box de 10 ampolas",
    contents: item?.contents ?? "10 ampolas",
    boxesPerPack: item?.boxesPerPack?.toString() ?? "",
    price: item?.price ?? "",
    priceSource: item?.priceSource ?? "Cotação confirmada pelo fornecedor",
  }));
  const identity = useRef({
    operationId: crypto.randomUUID(),
    id: initial?.id ?? crypto.randomUUID(),
  });
  const write = useInventoryWrite(entry ? "vendor-catalog" : "vendors");
  const [validation, setValidation] = useState("");
  const busy = write.pending || write.uncertain;
  const noun = entry ? "item" : "fornecedor";
  const field = (
    key: keyof typeof values,
    label: string,
    type = "text",
    maxLength = 200,
    readOnly = false,
  ) => (
    <label className="block space-y-1">
      <span>{label}</span>
      <Input
        type={type}
        value={String(values[key])}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
        maxLength={maxLength}
        readOnly={readOnly}
        {...(type === "number"
          ? { min: key === "price" ? "0.01" : "1", step: key === "price" ? "0.01" : "1" }
          : {})}
      />
    </label>
  );
  async function save(event: FormEvent) {
    event.preventDefault();
    const change = initial
      ? { action: "UPDATE", version: initial.version, reason: values.reason }
      : { action: "CREATE" };
    const input = {
      ...identity.current,
      ...change,
      name: values.name,
      active: values.active,
      ...(entry
        ? {
            supplierId: supplier?.id,
            code: values.code,
            supplierSku: values.supplierSku,
            kind: values.kind,
            description: values.description,
            packaging: values.packaging,
            contents: values.contents,
            boxesPerPack: values.boxesPerPack === "" ? null : Number(values.boxesPerPack),
            price: values.price,
            priceSource: values.priceSource,
          }
        : { phone: values.phone, email: values.email }),
    };
    const parsed = (entry ? supplierCatalogInput : supplierProfileInput).safeParse(input);
    if (!parsed.success) {
      setValidation(
        "Confira os campos. Informe preço positivo por apresentação, código, embalagem e motivo de edição com pelo menos 10 caracteres.",
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? `Editar ${noun}` : `Novo ${noun}`}</DialogTitle>
          <DialogDescription>
            {entry
              ? "O preço corresponde à apresentação comercial completa. Confirme valores e embalagem com o fornecedor."
              : "Cadastre o contato que receberá os pedidos."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <fieldset disabled={busy} className="space-y-4">
            {field(
              "name",
              entry ? "Nome completo do item" : "Nome do fornecedor",
              "text",
              entry ? 500 : 100,
            )}
            {entry ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {field("code", "Código interno", "text", 64, Boolean(item?.productId))}
                  {field("supplierSku", "SKU oficial do fornecedor (opcional)", "text", 100)}
                </div>
                <label className="block space-y-1">
                  <span>Tipo de item</span>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3"
                    value={values.kind}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, kind: e.target.value as typeof v.kind }))
                    }
                  >
                    <option value="PRODUCT">Produto</option>
                    <option value="KIT">Kit / protocolo comercial</option>
                    <option value="ADDON">Adicional</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <span>Descrição / composição do catálogo</span>
                  <textarea
                    className="min-h-24 w-full rounded-md border bg-background p-3"
                    value={values.description}
                    onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
                    maxLength={3000}
                  />
                </label>
                {field(
                  "packaging",
                  "Apresentação comercial",
                  "text",
                  200,
                  Boolean(item?.productId),
                )}
                {field(
                  "contents",
                  "Conteúdo da apresentação",
                  "text",
                  200,
                  Boolean(item?.productId),
                )}
                {field(
                  "boxesPerPack",
                  "Boxes físicos por apresentação (opcional)",
                  "number",
                  200,
                  Boolean(item?.productId),
                )}
                {item?.productId && (
                  <p className="text-xs text-muted-foreground">
                    Para mudar a embalagem de um item com pedidos, cadastre uma nova apresentação.
                  </p>
                )}
                {item?.pricingNote && (
                  <p className="rounded-md border p-3 text-sm">Arquivo: {item.pricingNote}</p>
                )}
                {field("price", "Preço por apresentação (R$)", "number")}
                {field("priceSource", "Fonte / data da cotação")}
              </>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {field("phone", "WhatsApp com código do país", "tel", 30)}
                {field("email", "E-mail (opcional)", "email", 254)}
              </div>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={values.active}
                onChange={(e) => setValues((v) => ({ ...v, active: e.target.checked }))}
              />
              {entry ? "Item ativo" : "Fornecedor ativo"}
            </label>
            {initial && field("reason", "Motivo da alteração", "text", 500)}
          </fieldset>
          {(validation || write.error) && (
            <div role="alert" className="rounded-md border p-3 text-sm">
              {validation || write.error?.message}
              {write.error?.status === 401 && (
                <Link to="/estoque/acesso" target="_blank" className="ml-2 underline">
                  Acessar demonstração
                </Link>
              )}
            </div>
          )}
          {write.uncertain && (
            <p role="status" className="text-sm">
              Resultado não confirmado. Tente novamente com os mesmos dados para evitar duplicação.
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
