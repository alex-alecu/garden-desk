export function selectedInputInstructions(inputNames: string[]): readonly string[] {
  const files = inputNames.map((name, index) => ({
    name,
    path: `/run/attachments/${String(index + 1).padStart(2, "0")}-${name}`,
  }));
  const pdfPaths = files
    .filter((file) => file.name.toLocaleLowerCase("en-US").endsWith(".pdf"))
    .map((file) => file.path);
  return [
    `Selected input count: ${files.length}.`,
    `Selected input files: ${JSON.stringify(files)}.`,
    ...(files.length === 0
      ? []
      : [
          "Inspect the exact selected input paths above before inspecting /source. /source may be empty and does not contain explicit attachments.",
          ...(pdfPaths.length === 0
            ? []
            : [
                `For attached PDFs ${JSON.stringify(pdfPaths)}, use one short Python source action with from pypdf import PdfReader and the exact path. Never cat a PDF or read its binary bytes as text.`,
              ]),
        ]),
  ];
}

export function continuationInstructions(continuation: boolean | undefined): readonly string[] {
  return continuation === true
    ? [
        "The user approved continuing the immediately preceding task. Resume its saved checkpoint instead of starting over.",
      ]
    : [];
}
