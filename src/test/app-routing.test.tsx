import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("matches the Patient 360 detail route", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/pacientes/ana-beatriz");

    expect(matches.at(-1)?.routeId).toBe("/pacientes/$patientId");
    expect(matches.at(-1)?.params).toMatchObject({ patientId: "ana-beatriz" });
  });
});

// These nested routes must render through the parent layout's Outlet.
describe("Inventory and applications routes", () => {
  for (const path of [
    "/estoque/recebimento",
    "/estoque/movimentacoes",
    "/estoque/produtos/00000000-0000-4000-8000-000000000001",
    "/aplicacoes/nova",
  ]) {
    it(`matches ${path}`, () => {
      const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
      expect(router.matchRoutes(path).at(-1)?.routeId).not.toBe(rootRouteId);
      expect(router.matchRoutes(path).at(-1)?.routeId).not.toBe("/estoque");
      expect(router.matchRoutes(path).at(-1)?.routeId).not.toBe("/aplicacoes");
    });
  }
});
