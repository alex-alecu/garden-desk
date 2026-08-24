export const cLocale = 'env={**os.environ, "LANG": "C", "LC_ALL": "C", "LC_CTYPE": "C"}';

const sourcePath = "/source/legacy-sample.doc";

export const approvedSource = [
  "from pathlib import Path",
  "import os",
  "import subprocess",
  `source = Path("${sourcePath}")`,
  `result = subprocess.run(["/usr/bin/antiword", "-m", "UTF-8.txt", "-w", "0", str(source)], capture_output=True, ${cLocale}, timeout=5, check=True)`,
  'text = result.stdout.decode("utf-8", errors="strict")',
  "if not text.strip():",
  '    raise RuntimeError("Antiword returned no text")',
].join("\n");

export const returnCodeGuardSource = approvedSource.replace(
  ", check=True)\ntext",
  ')\nif result.returncode != 0:\n    raise RuntimeError("Antiword failed")\ntext',
);

export const discoveredSource = [
  "from pathlib import Path",
  "import os",
  "import subprocess",
  'candidates = sorted(Path("/source").glob("*.doc"))',
  "document = candidates[0]",
  `result = subprocess.run(["/usr/bin/antiword", "-m", "UTF-8.txt", "-w", "0", str(document)], capture_output=True, ${cLocale}, timeout=5, check=True)`,
  'text = result.stdout.decode("utf-8", errors="strict")',
  "if not text.strip():",
  '    raise RuntimeError("Antiword returned no text")',
].join("\n");
