const C_LOCALE_ENTRIES = ["**os.environ", "'LANG':'C'", "'LC_ALL':'C'", "'LC_CTYPE':'C'"];

export function approvedAntiwordLocale(value: string): boolean {
  const normalized = value.replaceAll(/\s/gu, "").replaceAll('"', "'");
  if (!normalized.startsWith("{") || !normalized.endsWith("}")) return false;
  const entries = new Set(normalized.slice(1, -1).split(","));
  return (
    entries.size === C_LOCALE_ENTRIES.length &&
    C_LOCALE_ENTRIES.every((entry) => entries.has(entry))
  );
}
