export interface ToolCase {
  id: string;
  request: string;
  expectedTool: string | null;
  argument?: { name: string; pattern: RegExp };
}

export interface ChoiceCase {
  id: string;
  request: string;
  expectedTool: "task" | "review" | "bash" | "python";
  expectedSubagent?: string;
}

export const toolCases: ToolCase[] = [
  { id: "list-folder", request: "List the files in the selected folder.", expectedTool: "list" },
  {
    id: "read-pdf",
    request: "Read /source/contracts/lease.pdf and tell me what it is.",
    expectedTool: "read",
    argument: { name: "path", pattern: /lease\.pdf$/u },
  },
  {
    id: "read-first-lines",
    request: "Show me only the first 50 lines of /source/README.md.",
    expectedTool: "read",
    argument: { name: "limit", pattern: /^50$/u },
  },
  {
    id: "grep-word",
    request: "Find every file under /source that mentions the word termination.",
    expectedTool: "grep",
    argument: { name: "pattern", pattern: /terminat/iu },
  },
  {
    id: "grep-include",
    request: "Search for the text 'Invoice No' in /source/invoices, but only inside PDF files.",
    expectedTool: "grep",
    argument: { name: "include", pattern: /pdf/iu },
  },
  {
    id: "bash-command",
    request: "Run this command for me: ls -la /source",
    expectedTool: "bash",
    argument: { name: "command", pattern: /ls/u },
  },
  {
    id: "python-sum",
    request: "Use Python to compute the total of the column named amount in /source/expenses.xlsx.",
    expectedTool: "python",
    argument: { name: "source", pattern: /expenses\.xlsx/u },
  },
  {
    id: "write-note",
    request: "Create a file /workspace/notes.md that contains the single word Draft.",
    expectedTool: "write",
    argument: { name: "path", pattern: /\/workspace\/notes\.md$/u },
  },
  {
    id: "review-memo",
    request: "Proofread /source/memo.docx.",
    expectedTool: "review",
    argument: { name: "path", pattern: /memo\.docx$/u },
  },
  { id: "no-tool-greeting", request: "Say hello in French.", expectedTool: null },
  {
    id: "no-tool-definition",
    request: "In one sentence, what is a notice period in a lease?",
    expectedTool: null,
  },
];

export const choiceCases: ChoiceCase[] = [
  {
    id: "choose-folder-intake",
    request:
      "A client sent this folder with about 80 files and I do not know what is inside. Tell me what is there before we begin any work.",
    expectedTool: "task",
    expectedSubagent: "folder-intake",
  },
  {
    id: "choose-matter-chronology",
    request:
      "Build a dated timeline of what happened in this matter from the emails and letters in /source.",
    expectedTool: "task",
    expectedSubagent: "matter-chronology",
  },
  {
    id: "choose-contract-obligations",
    request:
      "List the payment terms, notice periods, and renewal conditions in /source/agreement.docx.",
    expectedTool: "task",
    expectedSubagent: "contract-obligations",
  },
  {
    id: "choose-document-comparison",
    request: "What changed between /source/msa-v3.docx and /source/msa-v4.docx?",
    expectedTool: "task",
    expectedSubagent: "document-comparison",
  },
  {
    id: "choose-financial-record-extraction",
    request:
      "Pull every transaction with its date, amount, and counterparty out of the bank statements in /source/statements into a table.",
    expectedTool: "task",
    expectedSubagent: "financial-record-extraction",
  },
  {
    id: "choose-financial-reconciliation",
    request:
      "Match the ledger in /source/ledger.xlsx against the bank statement in /source/bank.pdf and report every difference.",
    expectedTool: "task",
    expectedSubagent: "financial-reconciliation",
  },
  {
    id: "choose-invoice-expense-review",
    request:
      "Check the expense claims in /source/expenses for duplicates and for breaches of the travel policy in /source/policy.pdf.",
    expectedTool: "task",
    expectedSubagent: "invoice-expense-review",
  },
  {
    id: "choose-evidence-brief",
    request:
      "Using the records in /source/case, answer one question with citations: was the delivery late, and by how many days?",
    expectedTool: "task",
    expectedSubagent: "evidence-brief",
  },
  {
    id: "choose-general",
    request:
      "Review the medical records in /source/records and prepare the summary for a prior authorization request.",
    expectedTool: "task",
    expectedSubagent: "general",
  },
  {
    id: "choose-explore",
    request: "How does the authentication middleware in /source/src work?",
    expectedTool: "task",
    expectedSubagent: "explore",
  },
  { id: "choose-review", request: "Proofread /source/letter.docx.", expectedTool: "review" },
  {
    id: "choose-direct",
    request: "Give me a shell command that counts the PDF files in /source, and run it.",
    expectedTool: "bash",
  },
];
