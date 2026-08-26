# Document Tools Research 2026

Created: 2026-07-10

This document captures the current document tooling baseline for Vault Desk. It was revalidated against live web sources on 2026-07-11. These tools should still be benchmarked on actual accounting, legal, spreadsheet, and scanned document corpora before implementation.

## Sources Reviewed

- [Microsoft MarkItDown](https://github.com/microsoft/markitdown)
- [Docling](https://github.com/docling-project/docling)
- [Granite-Docling-258M model card](https://huggingface.co/ibm-granite/granite-docling-258M)
- [IBM Granite-Docling announcement](https://www.ibm.com/new/announcements/granite-docling-end-to-end-document-conversion)
- [Unstructured partitioning docs](https://docs.unstructured.io/open-source/core-functionality/partitioning)
- [PaddleOCR-VL-1.5 model card](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.5)
- [OmniDocBench](https://github.com/opendatalab/OmniDocBench)
- [MinerU](https://github.com/opendatalab/MinerU)
- [marker](https://github.com/datalab-to/marker)
- [TurboQuant paper](https://arxiv.org/abs/2504.19874)
- [turbovec](https://github.com/RyanCodrai/turbovec)
- [LanceDB](https://github.com/lancedb/lancedb)
- [sqlite-vec](https://github.com/asg017/sqlite-vec)
- [node-llama-cpp](https://node-llama-cpp.withcat.ai)
- [llama.cpp multimodal docs](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md)
- [Vercel AI SDK 6 announcement](https://vercel.com/blog/ai-sdk-6)
- [OpenTelemetry GenAI observability](https://opentelemetry.io/blog/2026/genai-observability/) — reviewed and rejected for the product audit contract; Vault Desk uses a small local schema and no telemetry exporter.

## Verified Parser Landscape (July 2026)

License posture matters as much as quality for a redistributable desktop product. Verified summary:

| Tool | Quality niche | License | Vault Desk fit |
|---|---|---|---|
| Docling | Best tables and complex layouts; offline; LF AI and Data project | MIT (code), Granite-Docling model Apache 2.0 | Primary high-fidelity path |
| Granite-Docling-258M | End-to-end page-image-to-DocTags VLM; table TEDS-structure 0.97; runs as GGUF under llama.cpp | Apache 2.0 | Key least-code option: Docling-class parsing through the same llama.cpp runtime that already serves Gemma; no Python sidecar |
| MarkItDown | Broad format conversion to Markdown | MIT | Broad first-pass adapter |
| Unstructured OSS | Broadest format coverage (25+ formats) | Apache 2.0 core | Fallback and parser-disagreement comparison |
| PaddleOCR-VL-1.5/1.6 | 0.9B document VLM; 94.5 on OmniDocBench v1.5; ~3 to 4 GB VRAM; llama.cpp support since March 2026 | Apache 2.0 including weights | Primary OCR path for scanned business documents |
| PaddleOCR ONNX pipeline | Classical OCR via onnxruntime-node; pure Node, ~15 to 20 MB models | Apache 2.0 | Lightweight CPU-only OCR fallback in Node |
| MinerU | Best raw table-structure accuracy (TEDS) | Custom Apache-based license with usage thresholds | Benchmark comparison only |
| marker / surya | Clean Markdown, strong OCR | GPL code plus OpenRAIL-M weights with revenue gates | Avoid without commercial license |
| pymupdf4llm / MuPDF.js | Fast native PDF extraction | AGPL or paid commercial | Avoid for proprietary distribution |
| Tesseract 5.x | Clean printed text, CPU | Apache 2.0 | Behind VLM OCR on real scans; not primary |

Benchmark flavor (vendor-run, research-derived): on a 200-document mixed business PDF benchmark, Docling 0.877, marker 0.861, MinerU 0.831. Specialized sub-1B document VLMs now lead OmniDocBench v1.5 (GLM-OCR 0.9B at 94.62, PaddleOCR-VL-1.5 at 94.50), beating far larger generalist VLMs.

## VLM OCR Versus Pipeline OCR

Verdict as of mid-2026: small specialized document VLMs (sub-1B params) have overtaken classical OCR pipelines for scanned business documents, and they fit easily in the Local 12 and Local 16 memory budget (PaddleOCR-VL ~3 GB, Granite-Docling 258M runs even on CPU).

Generalist VLM OCR has not: Gemma 4 multimodal is credible for understanding pages and cross-checking, but is not competitive with specialized document VLMs for faithful transcription of dense tables and small print, and long-table hallucination is the known failure mode. This confirms the existing Vault Desk rule: use Gemma for reasoning over already-extracted evidence and for escalation inspection of ambiguous regions, not as the transcription engine.

All VLMs degrade on physically degraded scans (warp, illumination, skew). Parser-disagreement warnings remain necessary.

## Recommended Tool Roles

The Local 12 and Local 16 performance constraint makes parser routing more important than adding model context. Vault Desk should preserve source structure, cache deterministic extraction, and send only selected evidence to Gemma 4 12B QAT.

### Native Node Parsers For Born-Digital Files

Least-code finding: most born-digital office files never need the heavy pipeline. Permissively licensed, actively maintained Node parsers cover them in-process:

- pdf.js (Apache 2.0): positioned text runs for digital PDFs.
- mammoth (BSD-2): DOCX to HTML/text.
- ExcelJS (MIT) or SheetJS (Apache 2.0, install from vendor registry, the npm copy is stale): spreadsheets with formulas, sheets, and cell coordinates.
- officeParser (MIT): DOCX/PPTX/XLSX/ODT to Markdown or AST.
- mailparser (check license; mailparser-mit is the MIT fork): EML/MIME email.

Route only scans, complex layouts, and low-confidence extractions to the heavy parsers.

### Docling And Granite-Docling

Use Docling-class parsing for layout-aware conversion of high-value PDFs where table structure, reading order, figures, and page anchors matter.

Two delivery options, in preference order for least code:

1. Granite-Docling-258M as a GGUF vision model under llama.cpp: converts page images end-to-end to DocTags with layout, tables, and formulas preserved, through the same runtime family Vault Desk already ships for Gemma. No Python process needed.
2. Docling (Python) as a sandboxed sidecar process (PyInstaller onedir or python-build-standalone, spawned from Node, IPC over localhost or stdio) when the full Docling pipeline is required.

### MarkItDown

Use MarkItDown as a broad first-pass converter inside the Python document worker for formats the native Node parsers do not cover. Do not rely on it for tables, spreadsheets, legal formatting, or high-value citations.

Security note: MarkItDown runs with the privileges of its process. Vault Desk should run it inside the document worker sandbox and call the narrowest conversion path possible for the current file.

### Unstructured

Use Unstructured as a fallback and comparison parser for mixed document sets and difficult partitioning cases. Its strategy levels (fast, hi_res, ocr_only) should drive warnings when a document requires slow or low-confidence extraction.

### Native Spreadsheet Parsing

Use structured spreadsheet parsing for XLSX, XLS, and CSV. Markdown conversion is not enough. Vault Desk needs formulas, sheets, cell coordinates, row windows, typed values, display values, CSV dialects, and deterministic calculations. ExcelJS or SheetJS satisfy this natively in Node.

### OCR

Primary: PaddleOCR-VL-1.5/1.6 (Apache 2.0, ~3 GB, llama.cpp-supported) for scanned pages. Fallback: the PaddleOCR ONNX pipeline via onnxruntime-node for CPU-only machines. Gemma 4 multimodal remains the escalation path for ambiguous regions, not the primary OCR engine.

### Vector Store And turbovec

TurboQuant (Google Research, ICLR 2026) is the algorithm; turbovec is the MIT Rust implementation with Python-only bindings. See [RETRIEVAL_AND_VERIFICATION.md](../RETRIEVAL_AND_VERIFICATION.md) for the integration decision.

Verified Node-native options:

- LanceDB (Apache 2.0): the only embedded Node store with native hybrid search (Tantivy full-text plus vector with reciprocal-rank fusion), binary quantization (RaBitQ 1 to 8 bit), and disk-native scaling. Known gotcha: must use LanceDB's bundled apache-arrow instance or inserts silently fail.
- sqlite-vec plus FTS5 (MIT/Apache dual): single-file simplicity, but pre-1.0, brute-force main path, experimental ANN.

## Parser Agreement Strategy

For high-value documents, Vault Desk should compare parser outputs:

- Native text extraction versus layout parser.
- Layout parser versus OCR.
- Spreadsheet structured parse versus Markdown conversion.
- Dense retrieval versus lexical search.

Disagreement should create warnings and review queues rather than being hidden.

## Minimal First Benchmark

The first benchmark should compare the smallest useful parser set:

- Native Node parsers for born-digital files (pdf.js text layer, mammoth, ExcelJS/SheetJS, officeParser, mailparser).
- Granite-Docling-258M GGUF versus Docling sidecar for high-fidelity PDF and layout conversion.
- PaddleOCR-VL for pages that need OCR.
- MarkItDown first-pass conversion for remaining formats.
- Unstructured only as fallback or parser-disagreement comparison.

Do not benchmark a custom parser or custom OCR path unless the maintained tools fail a required workflow.

## Benchmark Corpus Needed

Create private benchmark folders containing:

- 100-page PDFs.
- Scanned business records.
- Mixed digital and scanned PDFs.
- Multi-sheet XLSX files with formulas.
- Large CSV exports.
- DOCX contracts.
- DOCX files with tables.
- Files with images and low-quality scans.
- Physically degraded scans (warp, skew, poor lighting) to expose VLM OCR failure modes.
- Romanian and EU accounting documents.
- Duplicate and near-duplicate records.
