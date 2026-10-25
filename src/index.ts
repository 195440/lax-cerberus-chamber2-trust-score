export type AdmissionTest = "pass" | "fail" | "none" | boolean;

export type AgentRecord = {
  listingAgeDays?: number;
  acceptedDeliveries?: number;
  rejectedDeliveries?: number;
  admissionTest?: AdmissionTest;
  aiaxReady?: boolean;
  acpScore?: number;
};

export type Tier = "unproven" | "bronze" | "silver" | "gold";

export type TrustScoreResult = {
  score: number;
  tier: Tier;
  reasons: string[];
};

const TIER_ORDER: Record<Tier, number> = {
  unproven: 0,
  bronze: 1,
  silver: 2,
  gold: 3,
};

const TIER_BY_INDEX: Tier[] = ["unproven", "bronze", "silver", "gold"];

function sanitizeNonNegativeInt(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    return undefined;
  }
  if (value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function sanitizeAcpScore(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    return undefined;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

function sanitizeOutside(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    return undefined;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

function isAdmissionPass(admissionTest: AdmissionTest | undefined): boolean {
  if (admissionTest === true || admissionTest === "pass") {
    return true;
  }
  return false;
}

function acpScorePresent(record: AgentRecord): boolean {
  return sanitizeAcpScore(record.acpScore) !== undefined;
}

function isProven(record: AgentRecord, accepted: number, rejected: number): boolean {
  if (accepted + rejected > 0) {
    return true;
  }
  if (isAdmissionPass(record.admissionTest)) {
    return true;
  }
  if (acpScorePresent(record)) {
    return true;
  }
  return false;
}

export function tierFromScore(score: number): Tier {
  if (score >= 85) {
    return "gold";
  }
  if (score >= 60) {
    return "silver";
  }
  return "bronze";
}

export function clampTierOneStep(internal: Tier, candidate: Tier): Tier {
  const internalIndex = TIER_ORDER[internal];
  const candidateIndex = TIER_ORDER[candidate];
  const delta = candidateIndex - internalIndex;
  if (delta > 1) {
    return TIER_BY_INDEX[internalIndex + 1];
  }
  if (delta < -1) {
    return TIER_BY_INDEX[internalIndex - 1];
  }
  return candidate;
}

export function outsideTierReasons(
  internalTier: Tier,
  candidateTier: Tier,
): { finalTier: Tier; reasons: string[] } {
  const finalTier = clampTierOneStep(internalTier, candidateTier);
  const reasons: string[] = [];
  if (finalTier !== candidateTier) {
    reasons.push(
      `Tier clamp: candidate tier ${candidateTier} limited to one step from internal tier ${internalTier}, final tier ${finalTier}.`,
    );
  } else if (finalTier !== internalTier) {
    reasons.push(
      `Outside blend moved tier from internal ${internalTier} to ${finalTier}.`,
    );
  }
  return { finalTier, reasons };
}

function deliveryPoints(accepted: number, rejected: number): { points: number; reason: string | null } {
  const total = accepted + rejected;
  if (total <= 0) {
    return { points: 0, reason: null };
  }
  const volume = Math.min(total, 10);
  const ratio = accepted / total;
  const points = 40 * ratio * (volume / 10);
  const pct = Math.round(ratio * 100);
  return {
    points,
    reason: `Deliveries: ${accepted} accepted of ${total} (${pct}% ratio, volume capped at 10) contributed ${Math.round(points)} of 40 points.`,
  };
}

function listingAgePoints(listingAgeDays: number | undefined): { points: number; reason: string | null } {
  const raw = sanitizeNonNegativeInt(listingAgeDays);
  if (raw === undefined) {
    return { points: 0, reason: null };
  }
  const capped = Math.min(raw, 180);
  const points = 15 * (capped / 180);
  return {
    points,
    reason: `Listing age: ${capped} days (cap 180) contributed ${Math.round(points)} of 15 points.`,
  };
}

function admissionPoints(record: AgentRecord): { points: number; reason: string | null } {
  if (isAdmissionPass(record.admissionTest)) {
    return { points: 15, reason: "Admission test pass contributed 15 points." };
  }
  return { points: 0, reason: null };
}

function aiaxPoints(record: AgentRecord): { points: number; reason: string | null } {
  if (record.aiaxReady === true) {
    return { points: 10, reason: "AIAX ready contributed 10 points." };
  }
  return { points: 0, reason: null };
}

function acpPoints(record: AgentRecord): { points: number; reason: string | null } {
  const score = sanitizeAcpScore(record.acpScore);
  if (score === undefined) {
    return { points: 0, reason: null };
  }
  const points = 20 * (score / 100);
  return {
    points,
    reason: `ACP score ${score} contributed ${Math.round(points)} of 20 points.`,
  };
}

function computeInternalScore(record: AgentRecord): {
  internalScore: number;
  reasons: string[];
} {
  const accepted = sanitizeNonNegativeInt(record.acceptedDeliveries) ?? 0;
  const rejected = sanitizeNonNegativeInt(record.rejectedDeliveries) ?? 0;

  const parts = [
    deliveryPoints(accepted, rejected),
    listingAgePoints(record.listingAgeDays),
    admissionPoints(record),
    aiaxPoints(record),
    acpPoints(record),
  ];

  const rawSum = parts.reduce((sum, part) => sum + part.points, 0);
  const clamped = Math.min(100, Math.max(0, rawSum));
  const internalScore = Math.round(clamped);

  const reasons: string[] = [];
  for (const part of parts) {
    if (part.reason) {
      reasons.push(part.reason);
    }
  }
  reasons.push(`Internal score: ${internalScore} (sum clamped 0-100, rounded to nearest integer).`);

  return { internalScore, reasons };
}

export function scoreAgent(
  record: AgentRecord = {},
  outside?: number,
): TrustScoreResult {
  const accepted = sanitizeNonNegativeInt(record.acceptedDeliveries) ?? 0;
  const rejected = sanitizeNonNegativeInt(record.rejectedDeliveries) ?? 0;
  const proven = isProven(record, accepted, rejected);

  const { internalScore, reasons } = computeInternalScore(record);

  const internalTier: Tier = proven ? tierFromScore(internalScore) : "unproven";

  const sanitizedOutside = sanitizeOutside(outside);
  if (sanitizedOutside === undefined) {
    return {
      score: internalScore,
      tier: internalTier,
      reasons,
    };
  }

  const blended = Math.round(0.8 * internalScore + 0.2 * sanitizedOutside);
  const blendedClamped = Math.min(100, Math.max(0, blended));
  reasons.push(
    `Outside score ${sanitizedOutside} blended: round(0.8 * ${internalScore} + 0.2 * ${sanitizedOutside}) = ${blendedClamped}.`,
  );

  const candidateTier = tierFromScore(blendedClamped);
  const tierResolution = outsideTierReasons(internalTier, candidateTier);
  reasons.push(...tierResolution.reasons);

  return {
    score: blendedClamped,
    tier: tierResolution.finalTier,
    reasons,
  };
}
