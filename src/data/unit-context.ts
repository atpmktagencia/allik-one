const key = "allik_inventory_unit";
export function selectedUnitId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(key) ?? "";
}
export function setSelectedUnitId(unitId: string) {
  if (typeof window === "undefined") return;
  if (unitId) window.localStorage.setItem(key, unitId);
  else window.localStorage.removeItem(key);
  window.dispatchEvent(new CustomEvent("inventory-unit-change", { detail: unitId }));
}
export function withSelectedUnit(path: string) {
  const unitId = selectedUnitId();
  if (!unitId) return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set("unitId", unitId);
  return `${url.pathname}${url.search}`;
}
