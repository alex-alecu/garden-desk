export function reviewExtractionSource(path: string): string {
  return `from pathlib import Path
import os
import subprocess

path = Path(${JSON.stringify(path)})
suffix = path.suffix.lower()
if suffix == '.doc':
    text = subprocess.run(['antiword', '-m', 'UTF-8.txt', '-w', '0', str(path)],
        check=True, capture_output=True, text=True, encoding='utf-8',
        env={**os.environ, 'LC_ALL': 'C'}).stdout
elif suffix == '.docx':
    from docx import Document
    from docx.table import Table
    parts = []
    for block in Document(path).iter_inner_content():
        if isinstance(block, Table):
            parts.extend(' | '.join(cell.text for cell in row.cells) for row in block.rows)
        else:
            parts.append(block.text)
    text = '\\n'.join(parts)
elif suffix == '.pdf':
    from pypdf import PdfReader
    parts = []
    for number, page in enumerate(PdfReader(path).pages, 1):
        content = page.extract_text()
        if not content or not content.strip():
            raise ValueError('A page has no readable text. Scanned pages are unsupported.')
        parts.append(f'Page {number}\\n{content}')
    text = '\\n\\n'.join(parts)
elif suffix in ('.txt', '.md'):
    text = path.read_text(encoding='utf-8')
else:
    raise ValueError('Supported review attachments: DOC, DOCX, PDF, TXT, MD.')
if not text.strip():
    raise ValueError('The document has no readable text.')
text = '\\n'.join(f'{number}: {line}' for number, line in enumerate(text.splitlines(), 1))
Path('/workspace/.garden-desk-tools/review-extracted.txt').write_text(text, encoding='utf-8')
print(text)
`;
}
