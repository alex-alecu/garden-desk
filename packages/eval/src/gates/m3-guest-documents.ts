import type { CodeAgentSession } from "@vault/workers";
import { requireGuestSuccess } from "./m3-guest-execution.js";

export async function documentLibraryProbe(session: CodeAgentSession) {
  const result = await session.execute({
    language: "python",
    path: "steps/document-libraries.py",
    source: [
      "import json, pathlib",
      "from docx import Document",
      "from openpyxl import Workbook, load_workbook",
      "from pypdf import PdfReader",
      "from reportlab.lib.pagesizes import A4",
      "from reportlab.lib.styles import getSampleStyleSheet",
      "from reportlab.platypus import Paragraph, SimpleDocTemplate",
      "root = pathlib.Path('/workspace')",
      "docx_path = root / 'library-proof.docx'",
      "document = Document()",
      "document.add_heading('Library proof', level=1)",
      "document.add_paragraph('DOCX verified content')",
      "document.save(docx_path)",
      "docx_ok = [paragraph.text for paragraph in Document(docx_path).paragraphs] == ['Library proof', 'DOCX verified content']",
      "xlsx_path = root / 'library-proof.xlsx'",
      "workbook = Workbook()",
      "sheet = workbook.active",
      "sheet.title = 'Proof'",
      "sheet.append(['Value', 'Formula'])",
      "sheet.append([4, '=A2*3'])",
      "workbook.save(xlsx_path)",
      "reopened = load_workbook(xlsx_path, data_only=False)",
      "xlsx_ok = reopened['Proof']['B2'].value == '=A2*3'",
      "reopened.close()",
      "pdf_path = root / 'library-proof.pdf'",
      "SimpleDocTemplate(str(pdf_path), pagesize=A4, title='Library proof').build([Paragraph('PDF verified content', getSampleStyleSheet()['Title'])])",
      "pdf = PdfReader(pdf_path)",
      "pdf_ok = len(pdf.pages) == 1 and 'PDF verified content' in (pdf.pages[0].extract_text() or '') and pdf.metadata.title == 'Library proof'",
      "proof = {'docx': docx_ok, 'xlsx': xlsx_ok, 'pdf': pdf_ok}",
      "print(json.dumps(proof, sort_keys=True))",
    ].join("\n"),
  });
  requireGuestSuccess(result);
  const proof = JSON.parse(result.stdout) as { docx: boolean; pdf: boolean; xlsx: boolean };
  if (!proof.docx || !proof.xlsx || !proof.pdf) {
    throw new Error("Guest document library proof failed.");
  }
  return proof;
}
