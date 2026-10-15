import test from "node:test";
import assert from "node:assert/strict";
import { normalizeNewMigrationTimes } from "./generate-migration.mjs";

test("new migrations remain after existing migrations even when the clock is earlier", () => {
  const previous = [{ idx: 0, tag: "old", when: 100 }];
  const next = [...previous, { idx: 1, tag: "new", when: 10 }, { idx: 2, tag: "newer", when: 20 }];
  assert.deepEqual(
    normalizeNewMigrationTimes(previous, next).map((entry) => entry.when),
    [100, 101, 102],
  );
  assert.equal(next[1].when, 10);
  assert.deepEqual(previous, [{ idx: 0, tag: "old", when: 100 }]);
});
test("generation never repairs or rewrites an existing migration journal silently", () => {
  const previous = [{ idx: 0, tag: "old", when: 100 }];
  assert.throws(
    () => normalizeNewMigrationTimes(previous, [{ ...previous[0], when: 1 }]),
    /existing journal/,
  );
  assert.throws(() => normalizeNewMigrationTimes(previous, []), /existing journal/);
  assert.throws(
    () => normalizeNewMigrationTimes([...previous, { idx: 1, when: 90 }], []),
    /not strictly increasing/,
  );
});
