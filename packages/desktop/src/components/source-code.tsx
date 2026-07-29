import type { ReactNode } from "react";

type SourceLanguage = "node" | "python" | "plain";

const KEYWORDS: Record<Exclude<SourceLanguage, "plain">, Set<string>> = {
  python: new Set([
    "and",
    "as",
    "async",
    "await",
    "break",
    "class",
    "continue",
    "def",
    "del",
    "elif",
    "else",
    "except",
    "finally",
    "for",
    "from",
    "global",
    "if",
    "import",
    "in",
    "is",
    "lambda",
    "nonlocal",
    "not",
    "or",
    "pass",
    "raise",
    "return",
    "try",
    "while",
    "with",
    "yield",
  ]),
  node: new Set([
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "let",
    "new",
    "of",
    "return",
    "static",
    "switch",
    "throw",
    "try",
    "typeof",
    "var",
    "void",
    "while",
  ]),
};

const LITERALS = new Set(["False", "None", "True", "false", "null", "true", "undefined"]);
const BUILT_INS = new Set([
  "Array",
  "Buffer",
  "JSON",
  "Map",
  "Math",
  "Object",
  "Promise",
  "Set",
  "console",
  "dict",
  "enumerate",
  "float",
  "int",
  "len",
  "list",
  "open",
  "print",
  "range",
  "set",
  "str",
  "tuple",
]);

const TOKEN_PATTERNS = {
  python:
    /#[^\n]*|'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|@[A-Za-z_]\w*|\b(?:0[xX][\dA-Fa-f]+|\d+(?:\.\d+)?)\b|\b[A-Za-z_]\w*\b/g,
  node: /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\[\s\S]|[^`\\])*`|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|\b(?:0[xX][\dA-Fa-f]+|\d+(?:\.\d+)?)\b|\b[A-Za-z_$][\w$]*\b/g,
} as const;

function sourceLanguage(language: string): SourceLanguage {
  if (language === "python") return "python";
  if (language === "node") return "node";
  return "plain";
}

function tokenKind(token: string, language: Exclude<SourceLanguage, "plain">): string | undefined {
  if (token.startsWith("#") || token.startsWith("//") || token.startsWith("/*")) return "comment";
  if (["'", '"', "`"].includes(token[0] ?? "")) return "string";
  if (/^\d|^0[xX]/.test(token)) return "number";
  if (token.startsWith("@")) return "meta";
  if (KEYWORDS[language].has(token)) return "keyword";
  if (LITERALS.has(token)) return "literal";
  if (BUILT_INS.has(token)) return "builtin";
  return undefined;
}

function highlightedSource(source: string, language: SourceLanguage): ReactNode[] | string {
  if (language === "plain") return source;
  const pattern = new RegExp(TOKEN_PATTERNS[language]);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index;
    if (index > cursor) parts.push(source.slice(cursor, index));
    const token = match[0];
    const kind = tokenKind(token, language);
    parts.push(
      kind === undefined ? (
        token
      ) : (
        <span className={`syntax-${kind}`} key={`${index}:${kind}`}>
          {token}
        </span>
      ),
    );
    cursor = index + token.length;
  }
  if (cursor < source.length) parts.push(source.slice(cursor));
  return parts;
}

export function SourceCode({
  language,
  path,
  source,
}: {
  language: string;
  path: string;
  source: string;
}) {
  const syntax = sourceLanguage(language);
  const label = syntax === "python" ? "Python" : syntax === "node" ? "Node.js" : "Command";
  return (
    <div className="source-code">
      <div className="source-code-header">
        <span>{path}</span>
        <span>{label}</span>
      </div>
      <section aria-label={`${label} source for ${path}`}>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Overflowing source needs a keyboard scroll target. */}
        <pre tabIndex={0}>
          <code>{highlightedSource(source, syntax)}</code>
        </pre>
      </section>
    </div>
  );
}
