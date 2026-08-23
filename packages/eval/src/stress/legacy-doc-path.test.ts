import { describe, expect, it } from "vitest";
import {
  approvedDocumentPath,
  hasApprovedGlobDiscovery,
  hasApprovedIterdirDiscovery,
} from "./legacy-doc-path.js";

describe("legacy DOC direct path evidence", () => {
  it.each([
    '"/source/nested/../case.doc"',
    'Path("/source") / "nested" / ".." / "case.doc"',
    '"/run/attachments/nested/custom.DOC"',
    'pathlib.Path("/run/attachments") / "nested" / "custom.doc"',
  ])("accepts the normalized strict descendant %s", (value) => {
    expect(approvedDocumentPath(value)).toBe(true);
  });

  it.each([
    '"/source/../workspace/escape.doc"',
    'Path("/source") / ".." / "workspace" / "escape.doc"',
    'Path("/source") / "/workspace/escape.doc"',
  ])("rejects traversal outside an approved root in %s", (value) => {
    expect(approvedDocumentPath(value)).toBe(false);
  });

  it.each([
    '"/source"',
    'Path("/run/attachments")',
    '"/source-copy/escape.doc"',
    '"/run/attachments-copy/escape.doc"',
  ])("rejects root equality or a sibling-prefix path in %s", (value) => {
    expect(approvedDocumentPath(value)).toBe(false);
  });
});

describe("legacy DOC discovery path evidence", () => {
  it.each([
    'sorted(Path("/source").glob("*.doc"))',
    'list(pathlib.Path("/run/attachments").glob("*.doc"))',
    '(Path("/source") / "nested").glob("*.doc")',
  ])("accepts safe DOC discovery in %s", (value) => {
    expect(hasApprovedGlobDiscovery(value)).toBe(true);
  });

  it("accepts safe suffix-filtered attachment discovery", () => {
    const value =
      'next(path for path in Path("/run/attachments").iterdir() if path.suffix == ".doc")';
    expect(hasApprovedIterdirDiscovery(value)).toBe(true);
  });

  it.each([
    '(Path("/source") / ".." / "workspace").glob("*.doc")',
    'Path("/source-copy").glob("*.doc")',
    '(Path("/run/attachments") / ".." / "attachments-copy").glob("*.doc")',
  ])("rejects escaped or sibling-prefix discovery in %s", (value) => {
    expect(hasApprovedGlobDiscovery(value)).toBe(false);
  });
});
