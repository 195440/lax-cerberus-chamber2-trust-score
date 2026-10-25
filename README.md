# LAX Cerberus Chamber 2: Trust Score

Pure TypeScript module (no network) that computes a trust score and tier for a
LAX bidding agent from listing and ACP record fields. Built for Cerberus
chamber 2 deliverables.

## What it does

`scoreAgent(record, outside?)` returns `{ score, tier, reasons }`:

- `score`: integer 0 to 100 (blended when `outside` is provided)
- `tier`: `unproven`, `bronze`, `silver`, or `gold`
- `reasons`: human-readable strings for each scoring component and any blend or tier clamp

The function never throws on a (possibly empty) record object. Unproven agents
are never refused; they receive tier `unproven` until proof signals appear.

## Record interface

All fields on `record` are optional:

| Field | Type | Notes |
| --- | --- | --- |
| `listingAgeDays` | number | Days since listing; negative or NaN clamped or ignored |
| `acceptedDeliveries` | number | Non-negative integer; negative or NaN treated as 0 |
| `rejectedDeliveries` | number | Same sanitization as accepted |
| `admissionTest` | `pass` \| `fail` \| `none` \| boolean | `pass` or `true` adds points; `fail` or `false` does not |
| `aiaxReady` | boolean | Must be strictly `true` for points |
| `acpScore` | number | 0 to 100; out of range clamped; NaN treated as absent |

### Malformed values

- Negative delivery counts and listing age: clamped to 0 (still usable for proof if total deliveries > 0).
- `acpScore` below 0 clamped to 0; above 100 clamped to 100; NaN treated as absent (no ACP points, not proof via ACP).
- Invalid `outside` (NaN): treated as absent (no blend).
- Negative `outside`: clamped to 0; above 100 clamped to 100.

## Scoring (internal score)

Components sum to a raw total, then clamp to 0-100 and **round to the nearest integer** (half up).

| Component | Max points | Rule |
| --- | ---: | --- |
| Deliveries | 40 | Acceptance ratio times volume factor; volume = min(accepted + rejected, 10); ratio = accepted / total when total > 0 |
| Listing age | 15 | Linear in days, cap 180 days: `15 * min(age, 180) / 180` |
| Admission pass | 15 | Full 15 if `pass` or boolean `true` |
| AIAX ready | 10 | Full 10 if `aiaxReady === true` |
| ACP | 20 | `20 * (acpScore / 100)` on sanitized score |

## Proven vs unproven

**Proven** when any of:

- `acceptedDeliveries + rejectedDeliveries > 0` (after sanitization)
- admission test pass (`pass` or `true`)
- `acpScore` present after sanitization (including 0)

If not proven, **tier is always `unproven`** regardless of internal score.

## Tier thresholds (proven agents)

Applied to internal score, or to blended score before clamping:

| Score (inclusive) | Tier |
| --- | --- |
| 85 to 100 | gold |
| 60 to 84 | silver |
| 0 to 59 | bronze |

Scores below 30 still map to **bronze** (proven floor), not unproven.

## Outside score blend

When optional `outside` (0 to 100) is provided:

1. `blended = round(0.8 * internalScore + 0.2 * outside)` (then clamp 0-100)
2. `candidateTier = tierFromScore(blended)`
3. Final tier = `candidateTier` limited to **at most one tier step** from the internal tier (order: unproven < bronze < silver < gold)
4. Unproven agents can rise at most to **bronze** via outside score
5. Returned `score` is the blended value; reasons note the blend and any tier clamp

## Run the tests

```bash
npm install
npm test
npm run test:coverage
npm run typecheck
```

## House rules

- No secrets, wallet addresses, or contract addresses in this repository.
- Latin digits only; use plain hyphens in user-facing text (no long dashes).
