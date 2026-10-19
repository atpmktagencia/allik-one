import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PatientOverview,
  PatientOverviewVitals,
  type PatientOverviewProps,
} from "@/components/clinic/patient-overview";
import { PatientWorkspaceNavigation } from "@/components/clinic/patient-workspace-navigation";
import type { LaboratoryHistoryEntry } from "@/lib/laboratory-history";

const { useInventory } = vi.hoisted(() => ({ useInventory: vi.fn() }));
vi.mock("@/data/inventory-api", () => ({ useInventory }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    to?: string;
    params?: unknown;
    search?: unknown;
  }) => <a href={props.to}>{children}</a>,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const props = (): PatientOverviewProps => ({
  patientId: "patient-a",
  treatments: [],
  encounters: [],
  allergyReviewPending: false,
  unverifiedApplications: 0,
  onClinicalSummary: vi.fn(),
  onExams: vi.fn(),
  onTreatments: vi.fn(),
  onEncounters: vi.fn(),
});
const result = (
  id: string,
  name: string,
  value: string,
  reference: string | null,
): LaboratoryHistoryEntry => ({
  id,
  reviewId: "published-review",
  documentId: "original",
  documentTitle: "Original laboratorial",
  previewUrl: "/original",
  payload: {
    name,
    result: value,
    unit: "mg/dL",
    reference,
    collectedOn: "2026-10-12",
    reportedOn: "2026-10-13",
    laboratory: "Laboratório",
    method: null,
    material: null,
    evidence: null,
    sourcePage: null,
    uncertainty: null,
    verified: true,
  },
});

describe("Paciente360º overview", () => {
  it("labels the latest note's empty vital signs instead of displaying a blank card", () => {
    render(
      <PatientOverviewVitals
        note={{
          systolicPressure: null,
          diastolicPressure: null,
          heartRate: null,
          oxygenSaturation: null,
          temperatureC: null,
          weightKg: null,
          heightCm: null,
          finalizedAt: "2026-10-12T15:00:00Z",
        }}
      />,
    );
    expect(screen.getByText("Sinais vitais não informados")).toBeVisible();
    expect(screen.getByText(/Registro finalizado .*12\/10\/2026/)).toBeVisible();
  });
  it("preserves zero-valued vital signs instead of treating them as absent", () => {
    render(
      <PatientOverviewVitals
        note={{
          systolicPressure: 0,
          diastolicPressure: 0,
          heartRate: 0,
          oxygenSaturation: "0",
          temperatureC: "0",
          weightKg: "0",
          heightCm: "0",
          finalizedAt: "2026-10-12T15:00:00Z",
        }}
      />,
    );
    for (const label of [
      "PA 0/0 mmHg",
      "FC 0 bpm",
      "SpO₂ 0%",
      "T 0 °C",
      "Peso 0 kg",
      "Altura 0 cm",
    ])
      expect(screen.getByText(label)).toBeVisible();
    expect(screen.queryByText("Sinais vitais não informados")).not.toBeInTheDocument();
  });
  it("shows honest empty states without invented clinical results or diagnoses", () => {
    useInventory.mockReturnValue({ data: { rows: [], hasMore: false } });
    render(<PatientOverview {...props()} />);
    expect(screen.getByRole("region", { name: "Visão geral do paciente" })).toBeVisible();
    expect(screen.getByText(/Nenhum resultado confirmado disponível/)).toBeVisible();
    expect(screen.getByText("Nenhum tratamento marcado como ativo.")).toBeVisible();
    expect(screen.getByText("Sem pendências nesses registros.")).toBeVisible();
    expect(screen.queryByText(/Normal|Hipotireoidismo|SOP/)).not.toBeInTheDocument();
  });
  it("uses literal published results and keeps non-comparable values neutral", () => {
    useInventory.mockReturnValue({
      data: {
        rows: [
          result("a", "Glicemia", "95", "70 - 99"),
          result("b", "Resultado qualitativo", "Reagente", null),
          result("c", "Outro exame", "110", "70 - 99"),
        ],
      },
    });
    const current = props();
    render(<PatientOverview {...current} />);
    const exams = screen.getByRole("region", { name: "Exames recentes" });
    expect(within(exams).getByLabelText("Dentro da referência")).toBeVisible();
    expect(within(exams).getByLabelText("Referência não comparável")).toBeVisible();
    expect(within(exams).getByLabelText("Fora da referência")).toBeVisible();
    expect(within(exams).getByText("Reagente")).toBeVisible();
    fireEvent.click(within(exams).getByRole("button", { name: /Glicemia/ }));
    expect(current.onExams).toHaveBeenCalledOnce();
    expect(useInventory).toHaveBeenCalledWith("laboratory-history?patientId=patient-a&unitId=");
  });
  it("opens existing contexts for real pending items and excludes inactive treatments", () => {
    useInventory.mockReturnValue({ data: { rows: [] } });
    const current = props();
    render(
      <PatientOverview
        {...current}
        allergyReviewPending
        unverifiedApplications={2}
        treatments={[
          {
            id: "t1",
            productName: "Produto ativo",
            doseQuantity: "1",
            doseUnit: "UNIT",
            status: "ACTIVE",
            route: "IM",
          },
          {
            id: "t2",
            productName: "Produto encerrado",
            doseQuantity: "1",
            doseUnit: "UNIT",
            status: "COMPLETED",
            route: "IM",
          },
        ]}
      />,
    );
    expect(screen.getByText("Produto ativo")).toBeVisible();
    expect(screen.queryByText("Produto encerrado")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conferir alergias" }));
    expect(current.onClinicalSummary).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /2 aplicação/ }));
    expect(current.onTreatments).toHaveBeenCalledOnce();
  });
  it("does not label an unavailable laboratory request as an empty clinical history", () => {
    const refetch = vi.fn();
    useInventory.mockReturnValue({ error: new Error("forbidden"), refetch });
    render(<PatientOverview {...props()} />);
    expect(screen.getByText("Resultados indisponíveis para este acesso.")).toBeVisible();
    expect(screen.queryByText(/Nenhum resultado confirmado/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(refetch).toHaveBeenCalledOnce();
  });
  it("preserves the five patient sections and their accessible names when collapsed", () => {
    const onSelect = vi.fn(),
      onPreconsultation = vi.fn();
    render(
      <PatientWorkspaceNavigation
        patient={{ fullName: "Paciente sintético", internalCode: "TEST", unitName: "Unidade" }}
        section="overview"
        onSelect={onSelect}
        patientId="patient-a"
        onPreconsultation={onPreconsultation}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Seções do paciente" });
    expect(within(nav).getByRole("button", { name: "Visão geral" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(within(nav).getByRole("button", { name: "Recolher navegação do paciente" }));
    for (const label of ["Visão geral", "Consultas", "Documentos", "Exames", "Tratamentos"])
      expect(within(nav).getByRole("button", { name: label })).toBeInTheDocument();
    fireEvent.click(within(nav).getByRole("button", { name: /^Exames$/ }));
    expect(onSelect).toHaveBeenCalledWith("exams");
    fireEvent.click(within(nav).getByRole("button", { name: "Questionários" }));
    expect(onPreconsultation).toHaveBeenCalledOnce();
  });
});
