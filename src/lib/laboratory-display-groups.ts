/** Presentation grouping only. Does not normalize units, methods or clinical reference ranges. */
export const laboratoryDisplayGroups = [
  "Hematologia",
  "Metabolismo glicídico",
  "Perfil lipídico",
  "Função renal",
  "Função hepática",
  "Tireoide",
  "Hormônios",
  "Vitaminas e minerais",
  "Inflamação",
  "Outros",
] as const;
export function laboratoryDisplayGroup(name: string): (typeof laboratoryDisplayGroups)[number] {
  const text = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const rules: [RegExp, (typeof laboratoryDisplayGroups)[number]][] = [
    [/hemoglobina glicada|hba1c|glicemia|glicose|insulina|homa/, "Metabolismo glicídico"],
    [
      /hemograma|hemoglobina|hematocrito|leucocit|plaqueta|eritrocit|neutrofil|linfocit|eosinofil|basofil|monocit|^vcm$|^hcm$|^chcm$|^rdw$/,
      "Hematologia",
    ],
    [/colesterol|triglicer|^hdl|^ldl|^vldl|apolipoproteina/, "Perfil lipídico"],
    [/creatinina|ureia|filtracao glomerular|cistatina/, "Função renal"],
    [/^tgo|^tgp|^ast$|^alt$|bilirrubina|gama.*gt|fosfatase alcalina|albumina/, "Função hepática"],
    [/^tsh|^t3\b|^t4\b|tireoglobulina|tireoperoxidase|anti.tpo|tireoide/, "Tireoide"],
    [/testosterona|estradiol|progesterona|cortisol|prolactina|^fsh|^lh$|dhea|shbg/, "Hormônios"],
    [
      /vitamina|ferritina|ferro|zinco|selenio|magnesio|calcio|folato|acido folico/,
      "Vitaminas e minerais",
    ],
    [/proteina c reativa|^pcr|^vhs|velocidade de hemossedimentacao/, "Inflamação"],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? "Outros";
}
