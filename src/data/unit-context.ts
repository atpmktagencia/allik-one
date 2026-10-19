const key = "allik_inventory_unit";
export function selectedUnitId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(key) ?? "";
}
/** A clinical editor can veto a unit change before draft-reset listeners run. */
export function setSelectedUnitId(unitId: string): boolean {
  if (typeof window === "undefined") return true;
  if (selectedUnitId() === unitId) return true;
  const allowed = window.dispatchEvent(
    new CustomEvent("allik:before-unit-change", {
      cancelable: true,
      detail: { next: unitId },
    }),
  );
  if (!allowed) return false;
  if (unitId) window.localStorage.setItem(key, unitId);
  else window.localStorage.removeItem(key);
  window.dispatchEvent(new CustomEvent("inventory-unit-change", { detail: unitId }));
  return true;
}
export function withSelectedUnit(path: string) {
  const unitId = selectedUnitId();
  if (!unitId) return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set("unitId", unitId);
  return `${url.pathname}${url.search}`;
}
