# M3 Professional Document Skills Research

Created: 2026-08-15

This review covers public Agent Skills design and public legal, finance, healthcare, and report workflows. Claims remain research-derived until the Vault Desk physical and qualified reviewer gates pass.

## Findings

- The Agent Skills specification loads name and description metadata before the body. Descriptions must state the task and trigger. Skill bodies should use progressive disclosure.
- Public OpenAI and Anthropic guidance keeps shared workflows concise, puts detailed trigger text in descriptions, and validates skills with realistic positive and negative prompts.
- Public legal skill sets separate contract review, comparison, diligence, and other legal tasks. They require source citations and qualified legal review.
- Public finance skill sets separate statements, reconciliation, invoice or expense work, and variance analysis. They keep calculation evidence and human approval visible.
- Public healthcare skill sets use focused administrative workflows, explicit evidence states, and human review. Prompt text alone does not create a compliant health-data environment.
- Public report skills separate evidence work from reader-facing structure. They use answer-first results, evidence tables, caveats, source notes, and output verification.

## M3 Decision

Vault Desk adopts original prompt-only workflows. It does not copy public skill bodies or install their packages. One shared review skill owns evidence and safety rules. Twelve domain skills own focused tasks. One report skill owns a formal result when the user requests it.

The product uses only supplied files, policies, playbooks, and criteria. It does not use model memory as current law, accounting rules, payer policy, medical guidance, or code-set authority. Medical support is administrative only.

## Sources Reviewed

- [Agent Skills specification](https://agentskills.io/specification)
- [OpenAI skill creator](https://github.com/openai/skills/blob/main/skills/.system/skill-creator/SKILL.md)
- [Anthropic skill creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)
- [Anthropic legal contract review](https://github.com/anthropics/knowledge-work-plugins/blob/main/legal/skills/review-contract/SKILL.md)
- [Anthropic finance and accounting skills](https://github.com/anthropics/knowledge-work-plugins/blob/main/finance/README.md)
- [Anthropic financial services reference skills](https://github.com/anthropics/financial-services)
- [Anthropic healthcare reference skills](https://github.com/anthropics/healthcare)
- [OpenAI report-building skill](https://github.com/openai/role-specific-plugins/blob/main/plugins/data-analytics/skills/build-report/SKILL.md)
- [ABA Formal Opinion 512](https://www.americanbar.org/content/dam/aba/administrative/professional_responsibility/ethics-opinions/aba-formal-opinion-512.pdf)
- [HHS guidance on de-identification](https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html)
- [CMS prior-authorization final rule summary](https://www.cms.gov/newsroom/fact-sheets/cms-interoperability-prior-authorization-final-rule-cms-0057-f)

## Rejected Scope

- No copied third-party skill content or runtime package.
- No online research during a product review.
- No legal, tax, audit, investment, fraud, coding, billing, coverage, compliance, diagnosis, treatment, triage, or medical-necessity decision.
- No claim that local use, prompt rules, or de-identification make the product HIPAA compliant.
- No automatic domain router, skill bundle, policy engine, parser, OCR, retrieval, or citation verifier in Core.

## Validation Required

- Run all 12 held-out skill cases with the real Gemma worker and no-NIC guest on physical macOS and Windows.
- Review final case results blind with qualified legal, finance, and medical-administration reviewers.
- Manually inspect generated DOCX and PDF reports because the guest does not render them.
- Treat any safety failure, invented professional conclusion, missing critical issue, or unusable citation as release-blocking.
