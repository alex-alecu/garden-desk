import type { StressCaseDefinition } from "./document-workloads.js";
import {
  createEditableDocument,
  createEditableWorkbook,
  createPdfMergeInputs,
} from "./file-manipulation-fixtures.js";

export type FileManipulationCaseId = "docx-edit" | "pdf-merge" | "xlsx-edit";

export const FILE_MANIPULATION_CASES: StressCaseDefinition<FileManipulationCaseId>[] = [
  {
    id: "xlsx-edit",
    task: [
      "Open budget-model.xlsx and change only Budget!B3 from 125000 to 132500 and Budget!D3 from Pending to Board-approved revision.",
      "Save the edited workbook as revised-budget.xlsx.",
      "Preserve every formula, style, sheet name, hidden sheet, merged title, freeze pane, filter, and other cell.",
    ].join(" "),
    create: createEditableWorkbook,
    expected: () => [],
    deliverables: () => [
      {
        name: "revised-budget.xlsx",
        deterministic: true,
        facts: ["132500", "Board-approved revision", "AUDIT_KEEP_7F4B", "141000"],
        forbiddenFacts: ["125000", "Pending"],
        archiveFacts: [
          "<f>B3*1.1</f>",
          "<f>B4*1.1</f>",
          "AUDIT_KEEP_7F4B",
          'state="hidden"',
          'ref="A1:D1"',
          'topLeftCell="A3"',
          "autoFilter",
          "00D9EAD3",
        ],
      },
    ],
  },
  {
    id: "docx-edit",
    task: [
      "Edit risk-brief.docx: replace Pending legal review with Approved with conditions.",
      "Then append a Heading 2 named Next review followed by a normal paragraph containing 15 October 2026.",
      "Save as revised-risk-brief.docx and preserve the existing formatting, table, header, footer, and page setup.",
    ].join(" "),
    create: createEditableDocument,
    expected: () => [],
    deliverables: () => [
      {
        name: "revised-risk-brief.docx",
        deterministic: true,
        facts: [],
        archiveFacts: [
          "Approved with conditions",
          "Next review",
          "15 October 2026",
          "BODY_KEEP_A91C",
          "TABLE_KEEP_D22E",
          "HEADER_KEEP_18C2",
          "FOOTER_KEEP_42B7",
          "w:headerReference",
          "w:footerReference",
          "w:tblStyle",
          "w:pgSz",
        ],
        archiveForbiddenFacts: ["Pending legal review"],
      },
    ],
  },
  {
    id: "pdf-merge",
    task: [
      "Combine cover.pdf followed by every page of appendix.pdf into board-pack.pdf.",
      "Rotate only the final page 90 degrees clockwise and set the PDF title metadata to Board Pack 2026.",
      "Preserve the source page content and verify the page order, rotation, and title before delivery.",
    ].join(" "),
    create: createPdfMergeInputs,
    expected: () => [],
    deliverables: () => [
      {
        name: "board-pack.pdf",
        deterministic: true,
        facts: ["COVER_KEEP_10A4", "APPENDIX_PAGE_ONE_20B5", "APPENDIX_PAGE_TWO_30C6"],
        orderedFacts: ["COVER_KEEP_10A4", "APPENDIX_PAGE_ONE_20B5", "APPENDIX_PAGE_TWO_30C6"],
        pdfMetadata: { "/Title": "Board Pack 2026" },
        pdfRotations: [0, 0, 90],
      },
    ],
  },
];

export const FILE_MANIPULATION_CASE_IDS = FILE_MANIPULATION_CASES.map(({ id }) => id);
