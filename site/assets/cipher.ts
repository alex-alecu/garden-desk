const glyphs = "アイウエオカキクケコサシスセソ0123456789$#%&+=";

interface CipherCell {
  glyph: string;
  x: number;
  y: number;
  phase: number;
}

function randomGlyph(): string {
  return glyphs[Math.floor(Math.random() * glyphs.length)] ?? "0";
}

function seedCells(width: number, height: number): CipherCell[] {
  const cells: CipherCell[] = [];
  const step = 46;
  for (let y = step; y < height; y += step) {
    for (let x = step / 2; x < width; x += step) {
      if (Math.random() < 0.55) continue;
      cells.push({
        glyph: randomGlyph(),
        x: x + (Math.random() - 0.5) * 18,
        y: y + (Math.random() - 0.5) * 18,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }
  return cells;
}

function drawFrame(context: CanvasRenderingContext2D, cells: CipherCell[], time: number): void {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);
  const waveX = width * (0.5 + 0.42 * Math.sin(time / 9000));
  const waveY = height * (0.5 + 0.36 * Math.cos(time / 11000));
  context.font = "13px 'IBM Plex Mono', ui-monospace, monospace";
  context.textAlign = "center";
  for (const cell of cells) {
    if (Math.random() < 0.012) cell.glyph = randomGlyph();
    const distance = Math.hypot(cell.x - waveX, cell.y - waveY);
    const glow = Math.max(0, 1 - distance / (width * 0.3));
    const flicker = 0.5 + 0.5 * Math.sin(time / 1400 + cell.phase);
    const alpha = 0.09 + 0.08 * flicker + glow * 0.4;
    context.fillStyle =
      glow > 0.4 ? `rgb(79 214 192 / ${alpha})` : `rgb(159 182 187 / ${alpha * 0.7})`;
    context.fillText(cell.glyph, cell.x, cell.y);
  }
}

function attachField(section: HTMLElement): void {
  const canvas = document.createElement("canvas");
  canvas.className = "cipher-field";
  canvas.setAttribute("aria-hidden", "true");
  section.prepend(canvas);
  const context = canvas.getContext("2d");
  if (context === null) return;
  let cells: CipherCell[] = [];
  const resize = () => {
    canvas.width = section.clientWidth;
    canvas.height = section.clientHeight;
    cells = seedCells(canvas.width, canvas.height);
  };
  resize();
  new ResizeObserver(resize).observe(section);
  const frame = (time: number) => {
    drawFrame(context, cells, time);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export function enableCipherFields(): void {
  for (const section of document.querySelectorAll<HTMLElement>("[data-cipher]")) {
    attachField(section);
  }
}
