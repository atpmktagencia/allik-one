import { describe, expect, it } from "vitest";
import {
  questions,
  visibleQuestions,
  clearHiddenAnswers,
  sanitizePreconsultationAnswers,
  type PreconsultationQuestion,
} from "@/lib/preconsultation-questions";

const conditional = (): PreconsultationQuestion[] => [
  { id: "medicine", label: "Usa medicamentos?", type: "CHOICE", options: ["Sim", "Não"] },
  {
    id: "daily",
    label: "Uso diário?",
    type: "CHOICE",
    options: ["Sim", "Não"],
    visibleWhen: { questionId: "medicine", equals: "Sim" },
  },
  {
    id: "details",
    label: "Quais?",
    type: "TEXT",
    visibleWhen: { questionId: "daily", equals: "Sim" },
  },
];

describe("conditional preconsultation questions", () => {
  it("keeps existing unconditional versions and optional unanswered fields compatible", () => {
    const legacy = questions.parse([{ id: "concern", label: "Relato", type: "TEXT" }]);
    expect(sanitizePreconsultationAnswers(legacy, {})).toEqual({ concern: "" });
    expect(sanitizePreconsultationAnswers(legacy, { concern: "  Relato literal  " })).toEqual({
      concern: "  Relato literal  ",
    });
  });

  it("evaluates nested branches only while every ancestor is visible", () => {
    const items = conditional();
    expect(
      visibleQuestions(items, { medicine: "Não", daily: "Sim", details: "Stale" }).map((q) => q.id),
    ).toEqual(["medicine"]);
    expect(visibleQuestions(items, { medicine: "Sim", daily: "Não" }).map((q) => q.id)).toEqual([
      "medicine",
      "daily",
    ]);
    expect(visibleQuestions(items, { medicine: "Sim", daily: "Sim" })).toHaveLength(3);
    expect(visibleQuestions(items, {})).toHaveLength(1);
  });

  it.each([
    { questionId: "unknown", equals: "Sim" },
    { questionId: "details", equals: "Sim" },
    { questionId: "daily", equals: "Sim" },
    { questionId: "medicine", equals: "unknown" },
  ])("rejects unknown, forward, self or unsupported conditional values: %j", (visibleWhen) => {
    const items = conditional();
    items[1] = { ...items[1]!, visibleWhen };
    expect(questions.safeParse(items).success).toBe(false);
  });

  it("rejects conditions on TEXT, cycles, repeated IDs and unexpected condition fields", () => {
    expect(
      questions.safeParse([
        { id: "text", type: "TEXT", label: "Texto" },
        {
          id: "detail",
          type: "TEXT",
          label: "Detalhe",
          visibleWhen: { questionId: "text", equals: "Sim" },
        },
      ]).success,
    ).toBe(false);
    const items = conditional();
    items[0] = { ...items[0]!, visibleWhen: { questionId: "daily", equals: "Sim" } };
    expect(questions.safeParse(items).success).toBe(false);
    expect(questions.safeParse([conditional()[0], conditional()[0]]).success).toBe(false);
    expect(
      questions.safeParse([
        {
          ...conditional()[0],
          visibleWhen: { questionId: "daily", equals: "Sim", expression: "anything" },
        },
      ]).success,
    ).toBe(false);
  });

  it("rejects stale hidden sensitive answers, unknown keys and invalid choices on the server", () => {
    const items = conditional();
    expect(() =>
      sanitizePreconsultationAnswers(items, { medicine: "Não", details: "Sensitive old answer" }),
    ).toThrow(/oculta/);
    expect(() => sanitizePreconsultationAnswers(items, { medicine: "Não", daily: "Sim" })).toThrow(
      /oculta/,
    );
    expect(() => sanitizePreconsultationAnswers(items, { medicine: "Unknown" })).toThrow(/Opção/);
    expect(() => sanitizePreconsultationAnswers(items, { unknown: "Extra" })).toThrow(/declarada/);
    expect(sanitizePreconsultationAnswers(items, { medicine: "Não", details: "   " })).toEqual({
      medicine: "Não",
    });
  });

  it("clears whole hidden branches without mutating the client's answer state", () => {
    const answers = { medicine: "Não", daily: "Sim", details: "Sensitive old answer" };
    expect(clearHiddenAnswers(conditional(), answers)).toEqual({ medicine: "Não" });
    expect(answers.details).toBe("Sensitive old answer");
    expect(
      sanitizePreconsultationAnswers(conditional(), clearHiddenAnswers(conditional(), answers)),
    ).toEqual({ medicine: "Não" });
  });

  it("never uses inherited object members to activate a branch", () => {
    const items = questions.parse([
      { id: "toString", type: "CHOICE", label: "Escolha", options: ["Sim", "Não"] },
      {
        id: "detail",
        type: "TEXT",
        label: "Detalhe",
        visibleWhen: { questionId: "toString", equals: "Sim" },
      },
    ]);
    expect(visibleQuestions(items, {}).map((q) => q.id)).toEqual(["toString"]);
    expect(sanitizePreconsultationAnswers(items, {})).toEqual({ toString: "" });
  });
});
