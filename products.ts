// ─── BVC Pass Products ────────────────────────────────────────────────────────
// Centralised product definitions for Square checkout sessions.

export const PASS_PRODUCTS = {
  "10-pass": {
    name: "BVC 10-Session Pass",
    description: "10 rehearsal sessions for Bundaberg Voice Collective members.",
    sessionCount: 10,
    amountCents: 14000, // $140.00 AUD
    currency: "aud",
  },
  "5-pass": {
    name: "BVC 5-Session Pass",
    description: "5 rehearsal sessions for Bundaberg Voice Collective members.",
    sessionCount: 5,
    amountCents: 7500, // $75.00 AUD
    currency: "aud",
  },
  "single": {
    name: "BVC Single Session",
    description: "One rehearsal session for Bundaberg Voice Collective members.",
    sessionCount: 1,
    amountCents: 1600, // $16.00 AUD
    currency: "aud",
  },
  // Complimentary passes — $0, admin-assigned only, tracked for reporting
  "10-pass-comp": {
    name: "BVC 10-Session Pass (Complimentary)",
    description: "10 complimentary rehearsal sessions — no charge.",
    sessionCount: 10,
    amountCents: 0,
    currency: "aud",
  },
  "5-pass-comp": {
    name: "BVC 5-Session Pass (Complimentary)",
    description: "5 complimentary rehearsal sessions — no charge.",
    sessionCount: 5,
    amountCents: 0,
    currency: "aud",
  },
  "single-comp": {
    name: "BVC Single Session (Complimentary)",
    description: "One complimentary rehearsal session — no charge.",
    sessionCount: 1,
    amountCents: 0,
    currency: "aud",
  },
  // Carry-over — used when migrating paper-based passes; session count set by admin
  "custom-carryover": {
    name: "Carry-Over (Paper Pass Migration)",
    description: "Manually assigned carry-over sessions from a pre-existing paper pass — no charge.",
    sessionCount: 0, // overridden by admin input
    amountCents: 0,
    currency: "aud",
  },
} as const;

export type PassProductKey = keyof typeof PASS_PRODUCTS;
