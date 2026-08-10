import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractedArchiveText } from "./artifact-text.js";
import {
  createXlsxPathListCorpus,
  XLSX_PATH_LIST_ACCOUNTS,
  XLSX_PATH_LIST_MONTHS,
  XLSX_PATH_LIST_ROWS,
  xlsxPathListFileName,
} from "./xlsx-path-list-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("XLSX path-list regression fixture", () => {
  it("creates the ordered synthetic 12-month, 36-workbook incident shape", async () => {
    expect(XLSX_PATH_LIST_MONTHS).toEqual([
      "01_Ianuarie",
      "02_Februarie",
      "03_Martie",
      "04_Aprilie",
      "05_Mai",
      "06_Iunie",
      "07_Iulie",
      "08_August",
      "09_Septembrie",
      "10_Octombrie",
      "11_Noiembrie",
      "12_Decembrie",
    ]);
    expect(XLSX_PATH_LIST_ACCOUNTS).toEqual(["71028463", "82139574", "93240685"]);

    const root = await mkdtemp(join(tmpdir(), "vault-xlsx-path-list-"));
    temporaryRoots.push(root);
    const evidence = await createXlsxPathListCorpus(root);
    const directories = await readdir(root);

    expect(directories.toSorted()).toEqual([...XLSX_PATH_LIST_MONTHS].toSorted());
    expect(evidence.files).toBe(36);
    expect(evidence.bytes).toBeGreaterThan(0);
    for (const month of XLSX_PATH_LIST_MONTHS) {
      const files = await readdir(join(root, month));
      expect(files.toSorted()).toEqual(
        XLSX_PATH_LIST_ACCOUNTS.map((account) => xlsxPathListFileName(account)).toSorted(),
      );
      expect(files.every((name) => /^SYNTHACC_\d{8}\.XLSX$/u.test(name))).toBe(true);
      expect(files.every((name) => name.length === 22)).toBe(true);
    }
  });
});

describe("XLSX path-list workbook contents", () => {
  it("writes one exact incoming revenue row and outgoing noise to every valid archive", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-xlsx-path-list-"));
    temporaryRoots.push(root);
    const evidence = await createXlsxPathListCorpus(root);

    for (let index = 0; index < XLSX_PATH_LIST_ROWS.length; index += 1) {
      const month = XLSX_PATH_LIST_MONTHS[Math.floor(index / XLSX_PATH_LIST_ACCOUNTS.length)];
      const account = XLSX_PATH_LIST_ACCOUNTS[index % XLSX_PATH_LIST_ACCOUNTS.length];
      const expected = XLSX_PATH_LIST_ROWS[index];
      if (month === undefined || account === undefined || expected === undefined) {
        throw new Error("Incomplete path-list fixture plan.");
      }
      const text = await extractedArchiveText(join(root, month, xlsxPathListFileName(account)));
      expect(text).toContain("<workbook");
      expect(text).toContain("<worksheet");
      expect(text).toContain(expected.marker);
      expect(text).toContain(`<v>${expected.amount}</v>`);
      expect(text).toContain("incoming");
      expect(text).toContain("business revenue");
      expect(text).toContain("outgoing");
      expect(evidence.expected[`pathListMarker${index + 1}`]).toBe(expected.marker);
      expect(evidence.expected[`pathListAmount${index + 1}`]).toBe(expected.amount);
    }
  });
});
