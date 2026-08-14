# M3 Agent Guest Dependency Review

Updated: 2026-08-14

Decision: approved for the macOS arm64 and Windows x86_64 M3 guest images. Both architectures use the smallest fixed offline set that covers the named V1 tasks: Python and Node execution, JSON/CSV/SQLite from the standard library, common PDF, DOCX, XLSX, and image inspection, and plain-text reading of legacy DOC files. They contain no pip, npm, Corepack, package-install configuration, or runtime network path.

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
| Antiword | 0.37 with Debian 0.37-17 patches | GPL-2.0-or-later | Plain-text reading of legacy binary DOC input | Official source SHA-256 `4415e79d9f4c8d282a1cffbdaffe7ec0178982b9608e79bfd18561234a43e0cc` and Debian patch archive SHA-256 `e3bdff1911b4ccbf45bc977c6a1b79800f3ee8fdd11ec861cbfd60258176492b` |
| ReportLab | 5.0.0 | BSD-3-Clause | Styled PDF creation with Platypus | Official pure-Python wheel SHA-256 `9d5a3affa84919e1111ede580031266a570e93b1ce388219621347965ff1d93c` |
| charset-normalizer | 3.4.9 | MIT | ReportLab text encoding support | Official pure-Python wheel SHA-256 `68e5f26a1ad57ded6d1cfb85331d1c1a195314756471d97758c48498bb4dcdf5` |
| ReportLab bundled fonts | ReportLab 5.0.0 bundle | Bitstream Vera and GPL-2.0-or-later with font exception | Embedded PDF font resources | License texts retained inside the extracted wheel and package legal-info output |

Primary package records are the official [Node.js release archive](https://nodejs.org/download/release/v24.18.0/), [pypdf project](https://pypi.org/project/pypdf/6.14.2/), [openpyxl project](https://pypi.org/project/openpyxl/3.1.5/), [python-docx project](https://pypi.org/project/python-docx/1.2.0/), [ReportLab project](https://pypi.org/project/reportlab/5.0.0/), [charset-normalizer project](https://pypi.org/project/charset-normalizer/3.4.9/), and Debian's [Antiword 0.37-17 source](https://sources.debian.org/src/antiword/0.37-17/), [patch series](https://sources.debian.org/patches/antiword/0.37-17/), and [security record](https://security-tracker.debian.org/tracker/source-package/antiword). Exact downloaded wheel and archive filenames and hashes are enforced by Buildroot package hash files; the pure-Python wheels are extracted directly and never execute source-build or runtime installation behavior. The complete shipped set and bundled-font notices are recorded in `packages/workers/images/agent/manifest.json`; the Antiword record also carries its source, complete patch archive, installed size per architecture, and license-notice path.

## Boundary and maintenance decision

- These packages execute only inside the session-scoped no-NIC guest as an unprivileged user over a live read-only source mount, immutable attachments, and a bounded persistent tmpfs workspace.
- XML hardening remains enabled through `defusedxml`; document results are untrusted artifacts until Core validates their protocol, count, size, and content hash.
- Antiword has no active upstream. The Buildroot package applies all six Debian 0.37-17 patches: `10_fix_buffer_overflow_wordole_c.patch`, `50_antiword-manpage-hyphen-to-minus.patch`, `docx.patch`, `remove-dead-upstream-links.patch`, `use-snprintf.patch`, and `stop-parsing-documentsummary.patch`. This set includes the fixed CVE-2014-8123 overflow and removal of unsafe document-summary parsing. The package compiles only the `antiword` executable and installs no GUI script, PDF helper script, Java runtime, or package-manager path. Its stripped binary and required text resources must remain at or below 1 MiB. LibreOffice and Apache POI are rejected because the text-only M3 use case does not justify their larger runtimes and dependency sets.
- The final aarch64 image installs 254,284 Antiword bytes: 236,299 runtime bytes plus the 17,985-byte GPL notice. The final x86_64 image installs 258,548 bytes: 240,563 runtime bytes plus the same notice. Both stripped runtime sets are below the 1 MiB dependency gate.
- Legacy DOC support is input-only plain-text extraction. Tables can become plain text; layout, images, comments, macros, and embedded objects are unsupported. Antiword must reject corrupt, encrypted, XML, HTML, and ZIP-based input without another parser fallback.
- Runtime installation and arbitrary user packages are unsupported. A new library requires a new dependency review, exact pin, license update, reproducibility pass, and physical isolation gate.
- Generated images and downloaded wheels remain ignored. Distribution carries the guest manifest, third-party notices, SPDX SBOM, and resource hashes.
