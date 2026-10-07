import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
const createTestRouter = () =>
  createRouter({ routeTree, context: { queryClient: new QueryClient() } });

describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const matches = createTestRouter().matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("matches the Patient 360 detail route", () => {
    const matches = createTestRouter().matchRoutes("/pacientes/ana-beatriz");

    expect(matches.at(-1)?.routeId).toBe("/pacientes/$patientId");
    expect(matches.at(-1)?.params).toMatchObject({ patientId: "ana-beatriz" });
  });

  // Feature pages do not render <Outlet />. If a page route became the parent of a
  // detail route, the URL would change but the parent page would keep rendering.
  it.each([
    ["/pacientes", "/pacientes/"],
    ["/pacientes/ana-beatriz", "/pacientes/$patientId"],
    ["/estoque", "/estoque/"],
    ["/estoque/recebimento", "/estoque/recebimento"],
    ["/estoque/movimentacoes", "/estoque/movimentacoes"],
    ["/estoque/produtos/prod-001", "/estoque/produtos/$productId"],
    ["/aplicacoes", "/aplicacoes/"],
    ["/aplicacoes/nova", "/aplicacoes/nova"],
  ])("renders %s directly under the app shell", (path, routeId) => {
    const matches = createTestRouter().matchRoutes(path);

    expect(matches.map((match) => match.routeId)).toEqual([rootRouteId, routeId]);
  });
});
