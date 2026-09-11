import { describe, expect, it } from "vitest";
import { initialEstimate } from "../src/estimator.js";

describe("estimate", () => {
  it("returns a concrete wait time", () => {
    const estimate = initialEstimate("Fix the tests", "workspace_write", []);
    expect(estimate.estimatedRemainingMs).toBeGreaterThan(0);
    expect(Date.parse(estimate.estimatedCompletionAt)).toBeGreaterThan(Date.now());
    expect(estimate.recommendedWaitMs).toBeGreaterThanOrEqual(5_000);
  });
});
