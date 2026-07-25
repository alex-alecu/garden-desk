export const prompts = {
  finance: "Review the sample transactions and flag entries that need a human check.",
  agreement:
    "Extract key dates, obligations, renewal, and termination terms from the sample agreement.",
  health:
    "Summarize the sample patient-administration records without diagnosis or clinical recommendations.",
  cv: "Standardize the sample CV experience and skills without ranking or hiring recommendations.",
} as const;

export const guidedExamples = [
  { label: "Review transactions", prompt: prompts.finance },
  { label: "Read an agreement", prompt: prompts.agreement },
  { label: "Summarize admin records", prompt: prompts.health },
  { label: "Standardize a CV", prompt: prompts.cv },
];

export const responses = {
  [prompts.finance]: `## Items for human review

| Date | Description | Amount | Why review |
|---|---|---:|---|
| 14 May 2026 | Northstar Office Supply | €4,860.00 | Much larger than the usual monthly office-supply total |
| 19 May 2026 | Alderway Consulting | €2,400.00 | Similar amount appears twice on the same day |
| 28 May 2026 | Cash adjustment | €785.30 | Description does not identify a source document |

I found **3 entries** worth checking. This is a synthetic demonstration, not financial advice. Confirm every item against the original records.`,
  [prompts.agreement]: `## Agreement summary

- **Start date:** 1 September 2026
- **Initial term:** 12 months
- **Renewal:** Renews for another 12 months unless either party gives 45 days' written notice
- **Customer obligation:** Provide quarterly usage figures within 10 business days
- **Supplier obligation:** Maintain weekday support from 09:00 to 17:00
- **Termination:** Either party may terminate after an uncured material breach with 20 days' notice

These invented terms are presented for human review and are not legal advice.`,
  [prompts.health]: `## Administration summary

- Four synthetic appointment records were supplied.
- Two consent forms are recorded as received.
- One referral acknowledgement is still marked pending.
- The 18 August appointment has no transport preference recorded.

No diagnosis, treatment interpretation, or clinical recommendation was made. A staff member should verify the source records.`,
  [prompts.cv]: `## Standardized experience

**Mara Ionescu — Operations coordinator**

- Consolidated inventory updates from three regional teams.
- Prepared weekly status summaries and maintained supplier records.
- Skills stated in the sample: spreadsheet reporting, scheduling, vendor communication, Romanian, English.

This formatting example does not rank the person, assess suitability, or make a hiring recommendation.`,
} satisfies Record<string, string>;

export function responseFor(prompt: string): string | undefined {
  return (responses as Record<string, string | undefined>)[prompt];
}
