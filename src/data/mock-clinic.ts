// DEMONSTRATION DATA ONLY.
// This module is the temporary UI data boundary. Replace its exports with /api/v1/ adapters later.
export type Patient = {
  id: string;
  name: string;
  initials: string;
  age: number;
  cpf: string;
  phone: string;
  lastVisit: string;
  nextVisit: string;
  journey: string;
  tag: string;
};

export const patients: Patient[] = [
  {
    id: "ana-beatriz",
    name: "Ana Beatriz Lima",
    initials: "AL",
    age: 34,
    cpf: "000.000.001-00",
    phone: "(11) 90000-1001",
    lastVisit: "28/09/2026",
    nextVisit: "Hoje, 10:30",
    journey: "Protocolo facial",
    tag: "Em tratamento",
  },
  {
    id: "marina-costa",
    name: "Marina Costa Alves",
    initials: "MC",
    age: 41,
    cpf: "000.000.002-00",
    phone: "(11) 90000-1002",
    lastVisit: "30/09/2026",
    nextVisit: "06/10, 14:00",
    journey: "Acompanhamento",
    tag: "Ativa",
  },
  {
    id: "ricardo-mendes",
    name: "Ricardo Mendes",
    initials: "RM",
    age: 52,
    cpf: "000.000.003-00",
    phone: "(11) 90000-1003",
    lastVisit: "01/10/2026",
    nextVisit: "08/10, 09:00",
    journey: "Avaliação integrada",
    tag: "Novo",
  },
  {
    id: "luciana-prado",
    name: "Luciana Prado",
    initials: "LP",
    age: 38,
    cpf: "000.000.004-00",
    phone: "(11) 90000-1004",
    lastVisit: "02/10/2026",
    nextVisit: "12/10, 16:30",
    journey: "Programa de cuidado",
    tag: "Em tratamento",
  },
];

export const todaySchedule = [
  {
    time: "08:30",
    patientId: "marina-costa",
    patient: "Marina Costa Alves",
    type: "Retorno",
    professional: "Dra. Helena Prado",
    status: "Concluída",
  },
  {
    time: "09:30",
    patientId: "ricardo-mendes",
    patient: "Ricardo Mendes",
    type: "Avaliação inicial",
    professional: "Dr. Caio Nunes",
    status: "Em atendimento",
  },
  {
    time: "10:30",
    patientId: "ana-beatriz",
    patient: "Ana Beatriz Lima",
    type: "Aplicação",
    professional: "Dra. Helena Prado",
    status: "Confirmada",
  },
  {
    time: "11:40",
    patientId: "luciana-prado",
    patient: "Luciana Prado",
    type: "Acompanhamento",
    professional: "Dra. Lia Rocha",
    status: "Aguardando",
  },
  {
    time: "14:00",
    patientId: "marina-costa",
    patient: "Marina Costa Alves",
    type: "Exames",
    professional: "Enf. Clara Reis",
    status: "Confirmada",
  },
];

export const financial = {
  revenue: "R$ 184.320,00",
  target: "R$ 240.000,00",
  targetProgress: 77,
  receivable: "R$ 38.450,00",
  costs: "R$ 71.280,00",
  margin: "61,3%",
  ticket: "R$ 1.428,00",
};

export const sales = [
  {
    id: "#V-1048",
    patient: "Marina Costa Alves",
    item: "Programa de acompanhamento",
    date: "03/10/2026",
    value: "R$ 3.600,00",
    status: "Pago",
  },
  {
    id: "#V-1047",
    patient: "Ana Beatriz Lima",
    item: "Protocolo demonstrativo",
    date: "03/10/2026",
    value: "R$ 2.450,00",
    status: "Parcelado",
  },
  {
    id: "#V-1046",
    patient: "Ricardo Mendes",
    item: "Avaliação integrada",
    date: "02/10/2026",
    value: "R$ 680,00",
    status: "Pago",
  },
];

export const patientTimeline = [
  {
    date: "03 out 2026",
    title: "Consulta de acompanhamento",
    detail: "Registro demonstrativo de evolução, sem informação clínica real.",
    category: "Clínico",
  },
  {
    date: "28 set 2026",
    title: "Aplicação registrada",
    detail: "Sessão 2 de 4 concluída conforme plano fictício.",
    category: "Clínico",
  },
  {
    date: "20 set 2026",
    title: "Plano de cuidado iniciado",
    detail: "Termos e orientações demonstrativos registrados.",
    category: "Administrativo",
  },
  {
    date: "18 set 2026",
    title: "Primeiro contato via CRM",
    detail: "Origem: indicação. Conversão em avaliação inicial.",
    category: "Administrativo",
  },
];
