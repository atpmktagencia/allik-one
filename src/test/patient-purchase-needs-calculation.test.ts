import { describe, expect, it } from "vitest";
import { presentationsForDemand, shortagesForOpenings } from "@/server/patient-purchase-needs";

describe("patient purchase need calculation", () => {
  it("shares one presentation on the same day but not beyond a 24-hour safety window", () => {
    const sameDay = presentationsForDemand(
      [
        { scheduledOn: "2026-10-20", quantity: "5" },
        { scheduledOn: "2026-10-20", quantity: "5" },
      ],
      [],
      18,
      24,
    );
    expect(sameDay.presentations).toBe(1);
    const separateDays = presentationsForDemand(
      [
        { scheduledOn: "2026-10-20", quantity: "5" },
        { scheduledOn: "2026-10-21", quantity: "5" },
      ],
      [],
      18,
      24,
    );
    expect(separateDays.presentations).toBe(2);
  });

  it("uses safe open balance and respects physical lot expiry", () => {
    const calculation = presentationsForDemand(
      [
        { scheduledOn: "2026-10-20", quantity: "5" },
        { scheduledOn: "2026-10-27", quantity: "5" },
      ],
      [{ quantity: "5", usableThrough: "2026-10-20" }],
      18,
      24,
    );
    expect(calculation.presentations).toBe(1);
    expect(
      shortagesForOpenings(calculation.cumulative, [{ quantity: "1", expiresOn: "2026-10-26" }]),
    ).toEqual({ shortageUnits: 1, firstShortageOn: "2026-10-27" });
  });
});
