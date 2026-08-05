# M3 Agent Guest Dependency Review

Updated: 2026-08-04

Decision: approved for the macOS arm64 and Windows x86_64 M3 guest images. Both architectures use the smallest fixed offline set that covers the named V1 tasks: Python and Node execution, JSON/CSV/SQLite from the standard library, and common PDF, DOCX, XLSX, and image inspection. They contain no pip, npm, Corepack, package-install configuration, or runtime network path.

## Approved set

| Component | Version | License | M3 purpose | Pinning evidence |
| --- | --- | --- | --- | --- |
| Python | 3.14.5 | Python-2.0 | Python tasks and standard JSON, CSV, and SQLite codecs | Buildroot 2026.05 package resolution |
| Node.js | 24.18.0 arm64 and x64 | MIT and bundled notices | Node tasks matching the Core runtime major | Official archive SHA-256 `58c9520501f6ae2b52d5b210444e24b9d0c029a58c5011b797bc1fe7105886f6` (arm64) and `55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742` (x64) |
| Pillow | 12.0.0 | HPND | Common image inspection | Buildroot 2026.05 package resolution |
| pypdf | 6.14.2 | BSD-3-Clause | PDF reading and writing | Official wheel SHA-256 `3f07891af76dc002657e04993ab9b4de81de29f9013b9761d0b7968bff12e946` |
| openpyxl | 3.1.5 | MIT | XLSX reading and writing | Official wheel SHA-256 `5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2` |
| et-xmlfile | 2.0.0 | MIT | Required openpyxl XML writer | Official wheel SHA-256 `7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa` |
| defusedxml | 0.7.1 | Python-2.0 | Defensive XML parsing for spreadsheet inputs | Buildroot 2026.05 package resolution |
| python-docx | 1.2.0 | MIT | DOCX reading and writing | Official wheel SHA-256 `3fd478f3250fbbbfd3b94fe1e985955737c145627498896a8a6bf81f4baf66c7` |
| lxml and typing-extensions | Buildroot 2026.05 pins | BSD-3-Clause and PSF-2.0 | Required python-docx runtime dependencies | Buildroot package resolution |
| ReportLab | 5.0.0 | BSD-3-Clause | Styled PDF creation with Platypus | Official pure-Python wheel SHA-256 `9d5a3affa84919e1111ede580031266a570e93b1ce388219621347965ff1d93c` |
| charset-normalizer | 3.4.9 | MIT | ReportLab text encoding support | Official pure-Python wheel SHA-256 `68e5f26a1ad57ded6d1cfb85331d1c1a195314756471d97758c48498bb4dcdf5` |
| ReportLab bundled fonts | ReportLab 5.0.0 bundle | Bitstream Vera and GPL-2.0-or-later with font exception | Embedded PDF font resources | License texts retained inside the extracted wheel and package legal-info output |

Primary package records are the official [Node.js release archive](https://nodejs.org/download/release/v24.18.0/), [pypdf project](https://pypi.org/project/pypdf/6.14.2/), [openpyxl project](https://pypi.org/project/openpyxl/3.1.5/), [python-docx project](https://pypi.org/project/python-docx/1.2.0/), [ReportLab project](https://pypi.org/project/reportlab/5.0.0/), and [charset-normalizer project](https://pypi.org/project/charset-normalizer/3.4.9/). Exact downloaded wheel filenames and hashes are enforced by the Buildroot package hash file; the pure-Python wheels are extracted directly and never execute source-build or runtime installation behavior. The complete shipped set and bundled-font notices are recorded in `packages/workers/images/agent/manifest.json`.

## Boundary and maintenance decision

- These packages execute only inside the session-scoped no-NIC guest as an unprivileged user over a live read-only source mount, immutable attachments, and a bounded persistent tmpfs workspace.
- XML hardening remains enabled through `defusedxml`; document results are untrusted artifacts until Core validates their protocol, count, size, and content hash.
- Runtime installation and arbitrary user packages are unsupported. A new library requires a new dependency review, exact pin, license update, reproducibility pass, and physical isolation gate.
- Generated images and downloaded wheels remain ignored. Distribution carries the guest manifest, third-party notices, SPDX SBOM, and resource hashes.
