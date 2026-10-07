// DEMONSTRATION DATA ONLY.
// Temporary UI data boundary for stock and applications. Replace its exports with /api/v1/ adapters later.
export type StockStatus = "Normal" | "Estoque baixo" | "Crítico" | "Próximo do vencimento" | "Bloqueado";

export const stockLocations = ["Clínica Fortaleza", "Sala de Procedimentos", "Almoxarifado"];

export const stockProducts = [
  { id: "prod-001", name: "Injetável A", category: "Produto clínico", unit: "un", quantity: 86, minimum: 40, status: "Normal" as StockStatus, lot: "A24F08", expiry: "18/02/2027", cost: 185, location: "Clínica Fortaleza" },
  { id: "prod-002", name: "Injetável B", category: "Produto clínico", unit: "un", quantity: 18, minimum: 30, status: "Estoque baixo" as StockStatus, lot: "B25C11", expiry: "08/11/2026", cost: 240, location: "Clínica Fortaleza" },
  { id: "prod-003", name: "Material C", category: "Material", unit: "un", quantity: 240, minimum: 100, status: "Normal" as StockStatus, lot: "MC-2601", expiry: "30/01/2029", cost: 4.8, location: "Almoxarifado" },
  { id: "prod-004", name: "Kit de aplicação D", category: "Material", unit: "kit", quantity: 22, minimum: 25, status: "Estoque baixo" as StockStatus, lot: "KD-2512", expiry: "12/12/2026", cost: 32, location: "Sala de Procedimentos" },
  { id: "prod-005", name: "Produto E", category: "Produto clínico", unit: "un", quantity: 7, minimum: 12, status: "Crítico" as StockStatus, lot: "E25A03", expiry: "22/10/2026", cost: 310, location: "Clínica Fortaleza" },
  { id: "prod-006", name: "Injetável F", category: "Produto clínico", unit: "un", quantity: 34, minimum: 20, status: "Próximo do vencimento" as StockStatus, lot: "F25D19", expiry: "20/10/2026", cost: 165, location: "Sala de Procedimentos" },
];

export const stockLots = [
  { id: "lot-001", productId: "prod-001", lot: "A24F08", expiry: "18/02/2027", supplier: "Essentia", cost: 185, quantity: 86, status: "AVAILABLE" },
  { id: "lot-002", productId: "prod-001", lot: "A23B02", expiry: "09/12/2026", supplier: "Stin", cost: 179, quantity: 14, status: "AVAILABLE" },
  { id: "lot-003", productId: "prod-002", lot: "B25C11", expiry: "08/11/2026", supplier: "Essentia", cost: 240, quantity: 18, status: "AVAILABLE" },
  { id: "lot-004", productId: "prod-002", lot: "B24A17", expiry: "03/10/2026", supplier: "Stin", cost: 225, quantity: 0, status: "EXPIRED" },
  { id: "lot-005", productId: "prod-006", lot: "F25D19", expiry: "20/10/2026", supplier: "Essentia", cost: 165, quantity: 34, status: "AVAILABLE" },
];

export const stockMovements = [
  { id: "mov-001", productId: "prod-001", date: "03/10/2026 17:42", type: "Consumo do paciente", product: "Injetável A", lot: "A24F08", origin: "Sala de Procedimentos", destination: "Paciente", quantity: -2, location: "Sala de Procedimentos", responsible: "Enf. Ana Costa", reference: "APP-00182" },
  { id: "mov-002", productId: "prod-001", date: "03/10/2026 15:10", type: "Entrada de compra", product: "Injetável A", lot: "A24F08", origin: "Essentia", destination: "Clínica Fortaleza", quantity: 40, location: "Clínica Fortaleza", responsible: "Marcos Scorsafava", reference: "RCB-00031" },
  { id: "mov-003", productId: "prod-003", date: "03/10/2026 13:26", type: "Transferência", product: "Material C", lot: "MC-2601", origin: "Almoxarifado", destination: "Sala de Procedimentos", quantity: -20, location: "Almoxarifado", responsible: "João Silva", reference: "TRF-00018" },
  { id: "mov-004", productId: "prod-006", date: "02/10/2026 18:04", type: "Perda", product: "Injetável F", lot: "F25D19", origin: "Sala de Procedimentos", destination: "Perda", quantity: -1, location: "Sala de Procedimentos", responsible: "Enf. Ana Costa", reference: "AJU-00009" },
  { id: "mov-005", productId: "prod-004", date: "02/10/2026 10:18", type: "Ajuste", product: "Kit de aplicação D", lot: "KD-2512", origin: "Contagem", destination: "Sala de Procedimentos", quantity: 3, location: "Sala de Procedimentos", responsible: "João Silva", reference: "AJU-00008" },
];

export const applications = [
  { id: "APP-00182", date: "03/10/2026 17:42", patient: "Paciente A.", service: "Protocolo Metabólico", professional: "Enf. Ana Costa", product: "Injetável A", lot: "A24F08", quantity: 2, origin: "Pacote", status: "COMPLETED" },
  { id: "APP-00181", date: "03/10/2026 16:20", patient: "Paciente B.", service: "Aplicação direta", professional: "Enf. Ana Costa", product: "Injetável B", lot: "B25C11", quantity: 1, origin: "Produto direto", status: "COMPLETED" },
  { id: "APP-00180", date: "03/10/2026 14:05", patient: "Paciente C.", service: "Protocolo Metabólico", professional: "Dra. Júlia Lima", product: "Material C", lot: "MC-2601", quantity: 4, origin: "Serviço direto", status: "COMPLETED" },
];

export const formatBRL = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
