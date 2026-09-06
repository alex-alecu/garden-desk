type Point = [number, number, number];
type Surface =
  | "brick"
  | "brickDark"
  | "brickLight"
  | "stone"
  | "cream"
  | "iron"
  | "grout"
  | "wood"
  | "cityStone"
  | "cityGlass"
  | "cityWindow"
  | "roofTile"
  | "roofSlate"
  | "water"
  | "waterLight";
type Shape = "box" | "cylinder" | "gable" | "round" | "handle";
type Batch = { surface: Surface; shape: Shape; pieces: { at: Point; size: Point; turn: Point }[] };
type Add = ReturnType<typeof createAdder>;
type House = {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  finish: Surface;
  index: number;
};
type HouseFace = House & { roof: number; peak: number; front: number; face: number };

function createAdder(batches: Map<string, Batch>) {
  return (
    surface: Surface,
    at: Point,
    size: Point,
    { shape = "box", turn = [0, 0, 0] }: { shape?: Shape; turn?: Point } = {},
  ) => {
    const key = surface + shape;
    let batch = batches.get(key);
    if (!batch) {
      batch = { surface, shape, pieces: [] };
      batches.set(key, batch);
    }
    batch.pieces.push({ at, size, turn });
  };
}

function house(add: Add, building: House): void {
  const { x, z, width, depth, height, finish, index } = building;
  const roof = height - 10;
  const peak = width * (index % 3 === 0 ? 0.62 : 0.74);
  add(finish, [x, -10 + height / 2, z], [width, height, depth]);
  add("stone", [x, -9.65, z], [width + 0.05, 0.6, depth + 0.05]);
  add(index % 2 ? "roofTile" : "roofSlate", [x, roof, z], [width + 0.14, peak, depth + 0.18], {
    shape: "gable",
  });
  for (const face of [-1, 1]) {
    const front = z + face * (depth / 2 + 0.08);
    const facade = { ...building, roof, peak, front, face };
    houseGable(add, facade);
    houseWindows(add, facade);
    add("cream", [x, -9.04, front], [0.93, 1.84, 0.12]);
    add("iron", [x, -9.04, front + face * 0.075], [0.73, 1.68, 0.06]);
    add("stone", [x, -9.78, front + face * 0.4], [1.18, 0.26, 0.65]);
  }
  add("brickDark", [x + width * 0.28, roof + peak * 0.7, z - depth * 0.24], [0.42, 1.25, 0.48]);
  add("stone", [x + width * 0.28, roof + peak * 0.7 + 0.65, z - depth * 0.24], [0.55, 0.12, 0.61]);
}

function houseGable(
  add: Add,
  { x, width, roof, peak, front, finish, index, face }: HouseFace,
): void {
  add("cream", [x, roof - 0.1, front], [width + 0.16, 0.16, 0.2]);
  if (index % 3 === 0) {
    for (let step = 0; step < 4; step++) {
      const sw = width * (1 - step * 0.23);
      const sy = roof + (step * peak) / 4;
      add(finish, [x, sy + peak / 8, front], [sw, peak / 4, 0.19]);
      add("cream", [x, sy + peak / 4, front], [sw + 0.12, 0.09, 0.23]);
    }
  } else {
    add("cream", [x, roof - 0.025, front], [width + 0.12, peak + 0.14, 0.18], { shape: "gable" });
    add(finish, [x, roof, front + face * 0.1], [width - 0.12, peak - 0.08, 0.08], {
      shape: "gable",
    });
    if (index % 3 === 1) {
      add(finish, [x, roof + peak * 0.82, front], [width * 0.3, peak * 0.5, 0.23]);
      add("cream", [x, roof + peak * 1.08, front], [width * 0.38, 0.13, 0.29]);
    }
  }
  add("cream", [x, roof + peak * 0.36, front + face * 0.16], [0.66, 0.9, 0.09]);
  add("cityWindow", [x, roof + peak * 0.36, front + face * 0.22], [0.47, 0.69, 0.035]);
  add("iron", [x, roof + peak * 0.88, front + face * 0.4], [0.09, 0.11, 0.65]);
}

function houseWindows(add: Add, { x, width, roof, front, index, face }: HouseFace): void {
  const columns = width > 4.3 ? 3 : 2;
  for (let y = -7.7; y < roof - 0.7; y += 2) {
    for (let col = 0; col < columns; col++) {
      const wx = x - width / 2 + ((col + 0.5) * width) / columns;
      add("cream", [wx, y, front], [0.91, 1.49, 0.1]);
      add(
        (col + index) % 4 ? "cityWindow" : "cityGlass",
        [wx, y, front + face * 0.065],
        [0.7, 1.24, 0.035],
      );
      add("cream", [wx, y, front + face * 0.09], [0.045, 1.27, 0.03]);
      add("cream", [wx, y + 0.17, front + face * 0.09], [0.74, 0.045, 0.03]);
    }
  }
}

function island(add: Add, [x, z]: [number, number], [width, depth]: [number, number]): void {
  add("brickDark", [x, -10.15, z], [width, 0.8, depth]);
  add("stone", [x, -9.72, z], [width + 0.18, 0.14, depth + 0.18]);
  add("grout", [x, -9.63, z], [width - 0.7, 0.05, depth - 0.7]);
  for (const side of [-1, 1]) {
    for (let edge = -width / 2 + 1; edge < width / 2; edge += 3)
      add("iron", [x + edge, -9.33, z + side * (depth / 2 - 0.3)], [0.12, 0.55, 0.12], {
        shape: "cylinder",
      });
  }
}

function bridge(add: Add, at: [number, number], span: number, sideCanal = false): void {
  for (let i = 0; i < 16; i++) {
    bridgeSection(add, at, span, { i, sideCanal });
  }
}

function bridgeSection(
  add: Add,
  [x, z]: [number, number],
  span: number,
  { i, sideCanal }: { i: number; sideCanal: boolean },
): void {
  const offset = ((i + 0.5) / 16) * span - span / 2;
  const u = offset / (span / 2);
  const y = -9.64 + 0.95 * (1 - u * u);
  const slope = Math.atan((-3.8 * offset) / ((span * span) / 2));
  const position: Point = sideCanal ? [x + offset, y, z] : [x, y, z + offset];
  const size: Point = sideCanal ? [span / 16 + 0.04, 0.25, 2.8] : [2.8, 0.25, span / 16 + 0.04];
  const turn: Point = sideCanal ? [0, 0, slope] : [-slope, 0, 0];
  add("brickDark", position, size, { turn });
  for (const side of [-1, 1]) {
    const rail: Point = sideCanal
      ? [position[0], y + 0.74, z + side * 1.32]
      : [x + side * 1.32, y + 0.74, position[2]];
    add(
      "iron",
      rail,
      sideCanal ? [span / 16 + 0.05, 0.065, 0.07] : [0.07, 0.065, span / 16 + 0.05],
      { turn },
    );
    add("iron", [rail[0], y + 0.4, rail[2]], [0.055, 0.72, 0.055]);
  }
}

function boat(add: Add, [x, z]: [number, number], sail = false): void {
  add("iron", [x, -10.27, z], [1.4, 0.48, 3.7], { shape: "round" });
  add("wood", [x, -10.01, z], [1.2, 0.08, 3.2], { shape: "round" });
  add("cream", [x, -9.65, z - 0.3], [1.05, 0.66, 1.45], { shape: "round" });
  add("cityGlass", [x, -9.6, z + 0.44], [0.84, 0.34, 0.03]);
  if (sail) {
    add("iron", [x, -7.5, z], [0.065, 5.5, 0.065]);
    add("cream", [x - 0.1, -9.6, z], [2.6, 4.6, 0.05], {
      shape: "gable",
      turn: [0, Math.PI / 2, 0],
    });
  }
}

function houseRow(add: Add, row: number): void {
  const count = [19, 25, 9][row] as number;
  const z = [-1.2, -35, -64][row] as number;
  const finishes: Surface[] = ["brickLight", "brickDark", "brick", "cityStone"];
  let edge = row === 0 ? -40 : -54;
  for (let i = 0; i < count; i++) {
    const width = 3.25 + (i % 4) * 0.38;
    const x = edge + width / 2;
    edge += width + 0.18;
    if ((x > 7 && x < 20) || (row === 0 && Math.abs(x) < 6)) continue;
    const height = 6.4 + ((i * 3 + row) % 5) * 0.8;
    house(add, {
      x,
      z,
      width,
      depth: 7.5 + (i % 2),
      height,
      finish: finishes[i % 4] as Surface,
      index: i + row,
    });
  }
}

export function createCity(): Batch[] {
  const batches = new Map<string, Batch>();
  const add = createAdder(batches);
  add("water", [0, -10.52, -65], [360, 0.15, 250]);
  island(add, [-24.5, -0.3], [67, 17.8]);
  island(add, [42, -0.3], [48, 17.8]);
  island(add, [-24.5, -35], [67, 21]);
  island(add, [42, -35], [48, 21]);
  island(add, [-36, -64], [46, 18]);
  for (let row = 0; row < 3; row++) houseRow(add, row);
  bridge(add, [-12, -17.7], 15.5);
  bridge(add, [30, -17.7], 15.5);
  bridge(add, [-27, -50], 10.5);
  bridge(add, [24, -50], 10.5);
  bridge(add, [13.5, -7], 9.2, true);
  bridge(add, [13.5, -31], 9.2, true);
  boat(add, [13.5, 1]);
  boat(add, [13.5, -20]);
  boat(add, [-3, -18]);
  boat(add, [33, -50]);
  boat(add, [-18, -91], true);
  boat(add, [28, -59], true);
  for (let i = 0; i < 80; i++) {
    const x = -68 + ((i * 17) % 137);
    const z = (x > -10 ? -51 : -83) - ((i * 13) % 56);
    add("waterLight", [x, -10.43, z], [0.8 + (i % 5), 0.008, 0.035]);
  }
  return [...batches.values()];
}
