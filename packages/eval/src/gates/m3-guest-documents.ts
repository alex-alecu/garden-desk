import type { CodeAgentSession } from "@vault/workers";
import { requireM3ProductCheck } from "./m3-canonical-gate-reporting.js";
import { requireGuestSuccess } from "./m3-guest-execution.js";

const LEGACY_DOC_TEXT = [
  "",
  "",
  "This is just a small test document.",
  "",
  "",
  "This is just a small document to see if Antiword has been compiled correctly.",
  "The images will only show in the PostScript mode.",
  "",
  "[pic]",
  "",
  "Figure 1",
  "",
  "This JPEG image is the Antiword icon.",
  "",
  "[pic]",
  "",
  "Figure 2",
  "",
  "This PNG image is the cover of the O’Reilly book about PNG.",
  "NOTE: this image only shown correctly when Antiword is run with the “-i 0” option.",
  "",
].join("\n");

const DOCUMENT_LIBRARY_PROBE = [
  "import json, os, pathlib",
  "import shutil, subprocess",
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
  "def antiword(path):",
  "    return subprocess.run(['/usr/bin/antiword', '-m', 'UTF-8.txt', '-w', '0', str(path)], capture_output=True, check=False, env={**os.environ, 'LANG': 'C', 'LC_ALL': 'C', 'LC_CTYPE': 'C'}, timeout=5)",
  "legacy = antiword(pathlib.Path('/source/legacy-sample.doc'))",
  "try:",
  "    legacy_text = legacy.stdout.decode('utf-8', errors='strict')",
  "except UnicodeDecodeError:",
  "    legacy_text = ''",
  `expected_legacy = ${JSON.stringify(LEGACY_DOC_TEXT)}`,
  "doc_ok = legacy.returncode == 0 and legacy_text == expected_legacy",
  "corrupt_path = root / 'corrupt.doc'",
  "corrupt_path.write_bytes(b'not a Word document')",
  "corrupt_before = {item.name for item in root.iterdir()}",
  "corrupt_ok = antiword(corrupt_path).returncode != 0 and {item.name for item in root.iterdir()} == corrupt_before",
  "corrupt_path.unlink()",
  "mislabeled_path = root / 'mislabeled.doc'",
  "shutil.copyfile(docx_path, mislabeled_path)",
  "mislabeled_before = {item.name for item in root.iterdir()}",
  "mislabeled_ok = antiword(mislabeled_path).returncode != 0 and {item.name for item in root.iterdir()} == mislabeled_before",
  "mislabeled_path.unlink()",
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
  "proof = {'doc': doc_ok, 'docCorruptRejected': corrupt_ok, 'docxMislabelRejected': mislabeled_ok, 'docx': docx_ok, 'xlsx': xlsx_ok, 'pdf': pdf_ok}",
  "print(json.dumps(proof, sort_keys=True))",
].join("\n");

export async function documentLibraryProbe(session: CodeAgentSession) {
  const result = await session.execute({
    language: "python",
    path: "steps/document-libraries.py",
    source: DOCUMENT_LIBRARY_PROBE,
  });
  requireGuestSuccess(result);
  const proof = JSON.parse(result.stdout) as {
    doc: boolean;
    docCorruptRejected: boolean;
    docx: boolean;
    docxMislabelRejected: boolean;
    pdf: boolean;
    xlsx: boolean;
  };
  requireM3ProductCheck(
    proof.doc &&
      proof.docCorruptRejected &&
      proof.docxMislabelRejected &&
      proof.docx &&
      proof.xlsx &&
      proof.pdf,
    `Guest document library proof failed: ${JSON.stringify(proof)}`,
  );
  return proof;
}
