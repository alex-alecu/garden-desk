throw new Error(
  [
    "M3 remains open globally.",
    "The current candidate still has pending hard rows in docs/M3_READINESS.md.",
    "This sentinel does not parse that Markdown or infer evidence from an earlier build or another platform.",
  ].join(" "),
);
