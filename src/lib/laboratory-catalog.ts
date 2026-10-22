/** Versioned, read-only clinical identities. No numerical equivalence follows from an alias. */
export const laboratoryCatalogVersion = "f25-catalog-1";
export const laboratoryClinicalGroups = [
  "Hematologia",
  "Coagulação / Coagulograma",
  "Eletrólitos e minerais",
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
export type LaboratoryClinicalGroup = (typeof laboratoryClinicalGroups)[number];
export const foldLaboratoryName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[.,;:]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
export type LaboratoryCatalogItem = {
  id: string;
  name: string;
  synonyms: readonly string[];
  group: LaboratoryClinicalGroup;
  modalities: readonly ("PERCENTAGE" | "ABSOLUTE" | "LITERAL")[];
  compatibleUnits: readonly string[];
  comparability: "EXACT_UNIT_METHOD_MATERIAL_LABORATORY";
};
function item(
  id: string,
  name: string,
  group: LaboratoryClinicalGroup,
  synonyms: string[] = [],
  cell = false,
  units: string[] = [],
): LaboratoryCatalogItem {
  return {
    id,
    name,
    group,
    synonyms,
    modalities: cell ? ["PERCENTAGE", "ABSOLUTE"] : ["LITERAL"],
    compatibleUnits: cell ? ["%", "/mm³", "/mm3", "/µL", "10³/µL", "10⁹/L", ...units] : units,
    comparability: "EXACT_UNIT_METHOD_MATERIAL_LABORATORY",
  };
}
const hema = (
  id: string,
  name: string,
  aliases: string[] = [],
  cell = false,
  units: string[] = [],
) => item(id, name, "Hematologia", aliases, cell, units);
const coag = (id: string, name: string, aliases: string[], units: string[]) =>
  item(id, name, "Coagulação / Coagulograma", aliases, false, units);
const mineral = (id: string, name: string, aliases: string[], units: string[]) =>
  item(id, name, "Eletrólitos e minerais", aliases, false, units);
export const laboratoryCatalog: readonly LaboratoryCatalogItem[] = [
  hema("hemacias", "Hemácias", ["Eritrócitos", "Contagem de hemácias"], true, [
    "10⁶/µL",
    "milhões/mm³",
  ]),
  hema("hemoglobina", "Hemoglobina", ["Hb", "HGB"], false, ["g/dL"]),
  hema("hematocrito", "Hematócrito", ["Ht", "HCT"], false, ["%"]),
  hema("vcm", "VCM", ["Volume corpuscular médio"], false, ["fL"]),
  hema("hcm", "HCM", ["Hemoglobina corpuscular média"], false, ["pg"]),
  hema("chcm", "CHCM", ["Concentração de hemoglobina corpuscular média"], false, ["g/dL"]),
  hema("rdw", "RDW", ["RDW-CV"], false, ["%"]),
  hema(
    "leucocitos",
    "Leucócitos",
    ["Leucócitos global", "Leucócitos - global", "Leucócitos totais"],
    true,
  ),
  hema("neutrofilos", "Neutrófilos", [], true),
  hema("neutrofilos segmentados", "Neutrófilos segmentados", ["Segmentados"], true),
  hema("neutrofilos bastonetes", "Neutrófilos bastonetes", ["Bastonetes"], true),
  hema("linfocitos", "Linfócitos", [], true),
  hema("monocitos", "Monócitos", [], true),
  hema("eosinofilos", "Eosinófilos", [], true),
  hema("basofilos", "Basófilos", [], true),
  hema("blastos", "Blastos", [], true),
  hema("celulas atipicas", "Células atípicas", [], true),
  hema("linfocitos atipicos", "Linfócitos atípicos", [], true),
  hema("mielocitos", "Mielócitos", [], true),
  hema("metamielocitos", "Metamielócitos", [], true),
  hema("plaquetas", "Plaquetas", ["Contagem de plaquetas"], true),
  hema("reticulocitos", "Reticulócitos", [], true),
  coag(
    "tp",
    "Tempo de protrombina (TP)",
    ["TP", "Tempo de protrombina", "Tempo de protrombina - TP"],
    ["s", "segundos"],
  ),
  coag("atividade de protrombina", "Atividade de protrombina", ["Atividade protrombínica"], ["%"]),
  coag("inr", "INR", ["RNI", "Razão normalizada internacional"], ["razão"]),
  coag(
    "ttpa",
    "TTPa",
    ["Tempo de tromboplastina parcial ativada", "TTPA", "aPTT"],
    ["s", "segundos"],
  ),
  coag("fibrinogenio", "Fibrinogênio", [], ["mg/dL", "g/L"]),
  mineral("sodio", "Sódio", ["Na", "Sódio sérico"], ["mmol/L", "mEq/L"]),
  mineral("potassio", "Potássio", ["K", "Potássio sérico"], ["mmol/L", "mEq/L"]),
  mineral("cloro", "Cloro", ["Cl", "Cloreto", "Cloretos"], ["mmol/L", "mEq/L"]),
  mineral("calcio", "Cálcio", ["Ca", "Cálcio total"], ["mg/dL", "mmol/L"]),
  mineral("calcio ionizado", "Cálcio ionizado", ["Cálcio iônico"], ["mg/dL", "mmol/L"]),
  mineral("magnesio", "Magnésio", ["Mg"], ["mg/dL", "mmol/L"]),
  mineral("fosforo", "Fósforo", ["P", "Fósforo inorgânico"], ["mg/dL", "mmol/L"]),
  item(
    "pcr",
    "Proteína C-reativa (PCR)",
    "Inflamação",
    ["PCR", "Proteína C reativa", "Proteína C-reativa"],
    false,
    ["mg/L", "mg/dL"],
  ),
  item(
    "pcr ultrassensivel",
    "Proteína C-reativa ultrassensível",
    "Inflamação",
    ["PCR ultrassensível", "PCR-us", "Proteína C reativa ultrassensível"],
    false,
    ["mg/L", "mg/dL"],
  ),
  item("vhs", "VHS", "Inflamação", ["Velocidade de hemossedimentação"], false, ["mm/h"]),
  item(
    "hba1c",
    "HbA1c",
    "Metabolismo glicídico",
    ["Hemoglobina glicada", "Hemoglobina glicosilada"],
    false,
    ["%", "mmol/mol"],
  ),
  item("vitamina b12", "Vitamina B12", "Vitaminas e minerais", ["B12", "Cobalamina"], false, [
    "pg/mL",
    "pmol/L",
  ]),
  ...["T3", "T4"].flatMap((name) =>
    ["Livre", "Total"].map((form) =>
      item(
        `${name.toLowerCase()} ${form.toLowerCase()}`,
        `${name} ${form}`,
        "Tireoide",
        [],
        false,
        ["ng/dL", "pg/mL", "µg/dL", "pmol/L"],
      ),
    ),
  ),
];
const identities = new Map(
  laboratoryCatalog.flatMap((entry) =>
    [entry.name, ...entry.synonyms].map((name) => [foldLaboratoryName(name), entry] as const),
  ),
);
export function resolveLaboratoryCatalog(name: string) {
  return identities.get(foldLaboratoryName(name));
}
