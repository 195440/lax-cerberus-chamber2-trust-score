import { describe, expect, it } from "vitest";
import {
  clampTierOneStep,
  outsideTierReasons,
  scoreAgent,
  tierFromScore,
  type AgentRecord,
} from "../src/index.js";

describe("tierFromScore", () => {
  const cases: { score: number; tier: ReturnType<typeof tierFromScore> }[] = [
    { score: 0, tier: "bronze" },
    { score: 29, tier: "bronze" },
    { score: 30, tier: "bronze" },
    { score: 59, tier: "bronze" },
    { score: 60, tier: "silver" },
    { score: 84, tier: "silver" },
    { score: 85, tier: "gold" },
    { score: 100, tier: "gold" },
  ];

  it.each(cases)("score $score maps to $tier", ({ score, tier }) => {
    expect(tierFromScore(score)).toBe(tier);
  });
});

describe("scoreAgent proven tier boundaries", () => {
  it.each([
    {
      name: "score 29 stays bronze (proven floor)",
      record: {
        acceptedDeliveries: 3,
        rejectedDeliveries: 1,
        listingAgeDays: 180,
        acpScore: 10,
      } as AgentRecord,
      expectedScore: 29,
      expectedTier: "bronze",
    },
    {
      name: "score 30 bronze boundary",
      record: {
        acceptedDeliveries: 5,
        rejectedDeliveries: 0,
        listingAgeDays: 120,
      } as AgentRecord,
      expectedScore: 30,
      expectedTier: "bronze",
    },
    {
      name: "score 59 bronze before silver",
      record: {
        acceptedDeliveries: 8,
        rejectedDeliveries: 2,
        listingAgeDays: 180,
        acpScore: 60,
      } as AgentRecord,
      expectedScore: 59,
      expectedTier: "bronze",
    },
    {
      name: "score 60 silver boundary",
      record: {
        acceptedDeliveries: 10,
        rejectedDeliveries: 0,
        listingAgeDays: 120,
        acpScore: 50,
      } as AgentRecord,
      expectedScore: 60,
      expectedTier: "silver",
    },
    {
      name: "score 84 silver before gold",
      record: {
        acceptedDeliveries: 10,
        rejectedDeliveries: 0,
        listingAgeDays: 180,
        admissionTest: "pass",
        acpScore: 70,
      } as AgentRecord,
      expectedScore: 84,
      expectedTier: "silver",
    },
    {
      name: "score 85 gold boundary",
      record: {
        acceptedDeliveries: 10,
        rejectedDeliveries: 0,
        listingAgeDays: 180,
        admissionTest: "pass",
        acpScore: 75,
      } as AgentRecord,
      expectedScore: 85,
      expectedTier: "gold",
    },
  ])("$name", ({ record, expectedScore, expectedTier }) => {
    const result = scoreAgent(record);
    expect(result.score).toBe(expectedScore);
    expect(result.tier).toBe(expectedTier);
  });
});

describe("scoreAgent unproven", () => {
  it("empty record is unproven with score 0", () => {
    const result = scoreAgent({});
    expect(result.tier).toBe("unproven");
    expect(result.score).toBe(0);
    expect(result.reasons.some((r) => r.includes("Internal score"))).toBe(true);
  });

  it("never throws on empty object", () => {
    expect(() => scoreAgent({})).not.toThrow();
    expect(() => scoreAgent()).not.toThrow();
  });

  it("high computed score stays unproven without proof signals", () => {
    const result = scoreAgent({
      listingAgeDays: 180,
      aiaxReady: true,
    });
    expect(result.score).toBe(25);
    expect(result.tier).toBe("unproven");
  });

  it("high outside lifts unproven at most to bronze", () => {
    const result = scoreAgent({}, 100);
    expect(result.score).toBe(20);
    expect(result.tier).toBe("bronze");
    expect(result.reasons.some((r) => r.includes("Outside score"))).toBe(true);
  });
});

describe("clampTierOneStep", () => {
  it("limits movement to one tier step", () => {
    expect(clampTierOneStep("bronze", "gold")).toBe("silver");
    expect(clampTierOneStep("gold", "bronze")).toBe("silver");
    expect(clampTierOneStep("unproven", "gold")).toBe("bronze");
  });
});

describe("outsideTierReasons", () => {
  it("documents tier clamp when candidate exceeds one step", () => {
    const result = outsideTierReasons("bronze", "gold");
    expect(result.finalTier).toBe("silver");
    expect(result.reasons[0]).toContain("Tier clamp");
  });

  it("documents tier move within one step", () => {
    const result = outsideTierReasons("gold", "silver");
    expect(result.finalTier).toBe("silver");
    expect(result.reasons[0]).toContain("Outside blend moved tier");
  });
});

describe("scoreAgent outside blend and one-step clamp", () => {
  it("clamps tier up at most one step", () => {
    const record: AgentRecord = {
      acceptedDeliveries: 8,
      rejectedDeliveries: 2,
      listingAgeDays: 180,
      acpScore: 55,
    };
    const internal = scoreAgent(record);
    expect(internal.score).toBe(58);
    expect(internal.tier).toBe("bronze");

    const blended = scoreAgent(record, 100);
    expect(blended.score).toBe(66);
    expect(blended.tier).toBe("silver");
    expect(blended.reasons.some((r) => r.includes("Tier clamp"))).toBe(false);
  });

  it("clamps tier down at most one step from gold", () => {
    const record: AgentRecord = {
      acceptedDeliveries: 10,
      rejectedDeliveries: 0,
      listingAgeDays: 180,
      admissionTest: "pass",
      acpScore: 75,
    };
    const internal = scoreAgent(record);
    expect(internal.tier).toBe("gold");

    const blended = scoreAgent(record, 0);
    expect(blended.score).toBe(68);
    expect(blended.tier).toBe("silver");
    expect(blended.reasons.some((r) => r.includes("Outside score"))).toBe(true);
    expect(blended.reasons.some((r) => r.includes("Outside blend moved tier"))).toBe(
      true,
    );
  });

  it("clamps tier up at most one step when outside would jump two tiers", () => {
    const record: AgentRecord = {
      acceptedDeliveries: 5,
      rejectedDeliveries: 0,
      listingAgeDays: 120,
    };
    const blended = scoreAgent(record, 100);
    expect(blended.score).toBe(44);
    expect(blended.tier).toBe("bronze");
    expect(blended.reasons.some((r) => r.includes("Tier clamp"))).toBe(false);
  });

  it("no clamp when candidate matches internal tier", () => {
    const record: AgentRecord = {
      acceptedDeliveries: 10,
      rejectedDeliveries: 0,
      listingAgeDays: 120,
      acpScore: 50,
    };
    const result = scoreAgent(record, 60);
    expect(result.tier).toBe("silver");
    expect(result.reasons.some((r) => r.includes("Tier clamp"))).toBe(false);
  });
});

describe("scoreAgent malformed and edge inputs", () => {
  it.each([
    {
      name: "negative deliveries clamped to zero",
      record: {
        acceptedDeliveries: -5,
        rejectedDeliveries: -2,
        listingAgeDays: -10,
      },
      tier: "unproven" as const,
    },
    {
      name: "NaN fields treated absent",
      record: {
        acceptedDeliveries: Number.NaN,
        acpScore: Number.NaN,
        listingAgeDays: Number.NaN,
      },
      tier: "unproven" as const,
    },
    {
      name: "acp above 100 clamped",
      record: { acpScore: 150 },
      tier: "bronze" as const,
    },
    {
      name: "outside above 100 clamped in blend",
      record: { acpScore: 0 },
      outside: 200,
    },
    {
      name: "negative acp clamped to zero",
      record: { acpScore: -10 },
      tier: "bronze" as const,
    },
    {
      name: "negative outside clamped in blend",
      record: { acpScore: 0 },
      outside: -50,
    },
    {
      name: "NaN outside treated as absent",
      record: { acpScore: 0 },
      outside: Number.NaN,
      tier: "bronze" as const,
    },
    {
      name: "admission boolean true counts as pass",
      record: { admissionTest: true },
      tier: "bronze" as const,
    },
    {
      name: "admission boolean false no points",
      record: { admissionTest: false, acpScore: 0 },
      tier: "bronze" as const,
    },
  ])("$name", ({ record, outside, tier }) => {
    const result = scoreAgent(record, outside);
    expect(() => result).not.toThrow();
    if (tier) {
      expect(result.tier).toBe(tier);
    }
    if (outside !== undefined && outside > 100) {
      expect(result.reasons.some((r) => r.includes("Outside score 100"))).toBe(true);
    }
  });
});

describe("scoreAgent reasons", () => {
  it("lists component contributions", () => {
    const result = scoreAgent({
      acceptedDeliveries: 2,
      rejectedDeliveries: 1,
      listingAgeDays: 30,
      admissionTest: "pass",
      aiaxReady: true,
      acpScore: 80,
    });
    expect(result.reasons.some((r) => r.startsWith("Deliveries:"))).toBe(true);
    expect(result.reasons.some((r) => r.startsWith("Listing age:"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("Admission test pass"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("AIAX ready"))).toBe(true);
    expect(result.reasons.some((r) => r.startsWith("ACP score"))).toBe(true);
  });
});
