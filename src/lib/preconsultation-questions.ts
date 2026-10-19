import { z } from "zod";

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const question = z
  .object({
    id: identifier,
    label: z.string().trim().min(1).max(300),
    type: z.enum(["TEXT", "CHOICE"]),
    options: z.array(z.string().trim().min(1).max(150)).max(20).optional(),
    visibleWhen: z
      .object({ questionId: identifier, equals: z.string().trim().min(1).max(150) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.type === "CHOICE" && (!q.options?.length || new Set(q.options).size !== q.options.length))
      ctx.addIssue({ code: "custom", message: "Opções inválidas" });
  });

export const questions = z
  .array(question)
  .min(1)
  .max(30)
  .superRefine((items, ctx) => {
    const previous = new Map<string, z.infer<typeof question>>();
    items.forEach((item, index) => {
      if (previous.has(item.id))
        ctx.addIssue({ code: "custom", path: [index, "id"], message: "Identificador repetido" });
      if (item.visibleWhen) {
        const parent = previous.get(item.visibleWhen.questionId);
        if (
          !parent ||
          parent.type !== "CHOICE" ||
          !parent.options?.includes(item.visibleWhen.equals)
        )
          ctx.addIssue({
            code: "custom",
            path: [index, "visibleWhen"],
            message: "A condição precisa de uma opção de pergunta anterior",
          });
      }
      previous.set(item.id, item);
    });
  });
export type PreconsultationQuestion = z.infer<typeof question>;
type Answers = Readonly<Record<string, string>>;
const ownAnswer = (answers: Answers, id: string) =>
  Object.hasOwn(answers, id) ? (answers[id] ?? "") : "";

/** Conditions are evaluated in order; hidden ancestors cannot activate descendants. */
export function visibleQuestions(
  items: readonly PreconsultationQuestion[],
  answers: Answers,
): PreconsultationQuestion[] {
  const visible = new Set<string>();
  return items.filter((item) => {
    const condition = item.visibleWhen;
    const show =
      !condition ||
      (visible.has(condition.questionId) &&
        ownAnswer(answers, condition.questionId) === condition.equals);
    if (show) visible.add(item.id);
    return show;
  });
}

/** Client utility: discard answers immediately when their controlling branch becomes hidden. */
export function clearHiddenAnswers(
  items: readonly PreconsultationQuestion[],
  answers: Answers,
): Record<string, string> {
  return Object.fromEntries(
    visibleQuestions(items, answers).map((item) => [item.id, ownAnswer(answers, item.id)]),
  );
}

/** Server utility: validate against the invitation's immutable version, never the current draft. */
export function sanitizePreconsultationAnswers(
  items: readonly PreconsultationQuestion[],
  input: unknown,
): Record<string, string> {
  const checked = questions.parse(items);
  const values = z.record(z.string().max(64), z.string().max(4000)).parse(input);
  const visible = new Set(visibleQuestions(checked, values).map((item) => item.id));
  const known = new Set(checked.map((item) => item.id));
  if (Object.keys(values).some((id) => !known.has(id))) throw Error("Resposta não declarada");
  for (const item of checked) {
    const value = ownAnswer(values, item.id);
    if (!visible.has(item.id) && value.trim()) throw Error("Resposta de pergunta oculta");
    if (visible.has(item.id) && item.type === "CHOICE" && value && !item.options?.includes(value))
      throw Error("Opção inválida");
  }
  return clearHiddenAnswers(checked, values);
}
