---
name: pdf-reading
description: Guides local text extraction from attached PDF documents. Use when an explicit attachment has a PDF filename or the task asks to read an attached PDF.
---

# PDF Reading

## Overview

Read explicit PDF attachments locally with the installed Python library before answering from their contents.

## Process

1. For attached PDFs, use one short Python source action with from pypdf import PdfReader and the exact attachment path listed in the current task state.
2. Extract text from the real PDF. Never cat a PDF or decode the binary file as text.
3. Base the response on successful extraction evidence. A later follow-up may use durable successful history without extracting the same exact attachment again.
4. When the task explicitly expects invalid-input detection and requests a marker, catch the parse exception, print that exact marker to stdout, and exit normally with code 0. The marker is the completed validation result: do not repair the PDF, write an artifact, print a traceback, or execute again.

## Verification

- [ ] Every referenced PDF path was read successfully.
- [ ] The response is grounded in extracted content rather than the filename or a guess.
- [ ] An expected invalid-input marker exits normally without repair, artifacts, a traceback, or another execution.
