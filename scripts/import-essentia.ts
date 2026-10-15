import { getPool } from "../src/server/db";
import catalog from "../src/server/vendor-catalog/essentia.json";
import { importSupplierCatalog } from "./import-supplier-catalog";
try {
  await importSupplierCatalog(catalog);
} finally {
  await getPool().end();
}
