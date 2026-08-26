export type EditName = "write" | "edit";

export function editSource(operation: EditName, params: unknown): string {
  return [
    "from pathlib import Path",
    "import base64, difflib, json, sys",
    `op = ${JSON.stringify(operation)}`,
    `args = json.loads(${JSON.stringify(JSON.stringify(params))})`,
    "def text(name): return base64.b64decode(args[name]).decode('utf-8')",
    "path = Path(args['path'])",
    "if not str(path.resolve()).startswith('/workspace/'): sys.exit('unsupported_path: write and edit change only files under /workspace')",
    "if op == 'write':",
    "    data = text('content').encode('utf-8')",
    "    path.parent.mkdir(parents=True, exist_ok=True)",
    "    path.write_bytes(data)",
    "    print(f'wrote {len(data)} bytes to {path}')",
    "else:",
    "    if not path.is_file(): sys.exit(f'edit_file_missing: {path} is not an existing file')",
    "    try:",
    "        before = path.read_bytes().decode('utf-8')",
    "    except UnicodeDecodeError:",
    "        sys.exit('edit_requires_utf8_text: this file is not UTF-8 plain text')",
    "    old, new, every = text('old'), text('new'), bool(args.get('replace_all'))",
    "    matches = before.count(old)",
    "    if matches == 0: sys.exit('edit_old_not_found: read the file and copy the exact existing text')",
    "    if matches > 1 and not every:",
    "        sys.exit(f'edit_old_not_unique: old matches {matches} times; add surrounding lines or set replace_all')",
    "    after = before.replace(old, new) if every else before.replace(old, new, 1)",
    "    path.write_bytes(after.encode('utf-8'))",
    "    sys.stdout.writelines(difflib.unified_diff(before.splitlines(True), after.splitlines(True), str(path), str(path)))",
  ].join("\n");
}
