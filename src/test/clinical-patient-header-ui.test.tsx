import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClinicalPatientHeader } from "@/components/clinic/clinical-patient-header";

afterEach(cleanup);

describe("Clinical patient header", () => {
  it("displays supplied clinical information without inferring normality or diagnoses", () => {
    render(
      <ClinicalPatientHeader
        name="Paciente sintético"
        code="P001"
        unitName="Unidade de teste"
        birthDate="1990-04-12"
        secondaryInfo="Contato verificado"
      />,
    );
    const header = screen.getByRole("region", { name: "Resumo clínico do paciente" });
    expect(within(header).getByText("Paciente sintético")).toBeInTheDocument();
    expect(within(header).getByText("ID P001 · Unidade de teste")).toBeInTheDocument();
    expect(within(header).getByText("Nascimento: 12/04/1990")).toBeInTheDocument();
    expect(within(header).getByText("Contato verificado")).toBeInTheDocument();
    expect(within(header).getByText("Sem sinais vitais registrados.")).toBeInTheDocument();
    expect(within(header).getByText("Consulte o registro de alergias.")).toBeInTheDocument();
    expect(
      within(header).getByText("Sem diagnósticos registrados neste contexto."),
    ).toBeInTheDocument();
    expect(
      within(header).queryByText(/sem alergias|normal|hipotireoidismo/i),
    ).not.toBeInTheDocument();
  });

  it("preserves the real vital, allergy, diagnosis and action controls supplied by the page", () => {
    render(
      <ClinicalPatientHeader
        name="Outro paciente sintético"
        vitals={<p>PA 110/70 mmHg · medida registrada</p>}
        allergies={<button type="button">Conferir alergias registradas</button>}
        diagnoses={<p>Hipótese em investigação</p>}
        actions={<button type="button">Ver resumo completo</button>}
      />,
    );
    expect(screen.getByText("PA 110/70 mmHg · medida registrada")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Conferir alergias registradas" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Hipótese em investigação")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver resumo completo" })).toBeInTheDocument();
    expect(screen.queryByText("Consulte o registro de alergias.")).not.toBeInTheDocument();
    expect(screen.queryByText("Sem sinais vitais registrados.")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Sem diagnósticos registrados neste contexto."),
    ).not.toBeInTheDocument();
  });
});
