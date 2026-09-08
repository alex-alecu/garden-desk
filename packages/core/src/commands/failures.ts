const commandFailures: Record<string, string> = {
  command_not_found: "This command is not available. Type / to see the command list.",
  agent_review_attachment_required: "Attach exactly one document, then use /review again.",
  agent_review_extraction_failed:
    "The document text could not be extracted. Use a DOC, DOCX, text PDF, TXT, or MD file.",
  agent_review_input_unsupported: "The review input is not supported. Try a shorter document.",
  agent_review_tools_unavailable:
    "The review requested an unavailable tool. No further action was taken.",
};

export function commandFailureSummary(code: string): string | undefined {
  return commandFailures[code];
}
