type Point = [number, number, number];
type Surface =
  | "brick"
  | "brickDark"
  | "brickLight"
  | "stone"
  | "iron"
  | "grout"
  | "wood"
  | "cityStone"
  | "cityGlass"
  | "cityWindow";
type Shape = "box" | "cylinder" | "cone";
type Batch = { surface: Surface; shape: Shape; pieces: { at: Point; size: Point }[] };

export function createCity(): Batch[] {
  const batches = new Map<string, Batch>();
  const add = (surface: Surface, at: Point, size: Point, shape: Shape = "box") => {
    const key = surface + shape;
    let batch = batches.get(key);
    if (!batch) {
      batch = { surface, shape, pieces: [] };
      batches.set(key, batch);
    }
    batch.pieces.push({ at, size });
  };

  const roof = (x: number, z: number, width: number, depth: number, y: number, index: number) => {
    add("iron", [x, y + 0.05, z], [width, 0.1, depth]);
    for (const side of [-1, 1]) {
      add("stone", [x, y + 0.16, z + (side * depth) / 2], [width + 0.12, 0.3, 0.15]);
      add("stone", [x + (side * width) / 2, y + 0.16, z], [0.15, 0.3, depth]);
    }
    add("cityStone", [x - width * 0.24, y + 0.48, z - depth * 0.22], [1.1, 0.8, 1.6]);
    add("iron", [x - width * 0.24, y + 0.9, z - depth * 0.22], [1.2, 0.1, 1.7]);
    if (index % 3 === 0) {
      const tx = x + width * 0.2;
      for (const side of [-1, 1]) add("iron", [tx + side * 0.42, y + 0.45, z], [0.09, 0.9, 0.8]);
      add("wood", [tx, y + 1.3, z], [0.66, 1.3, 0.66], "cylinder");
      add("iron", [tx, y + 1.98, z], [0.73, 0.12, 0.73], "cylinder");
      add("iron", [tx, y + 2.25, z], [0.74, 0.48, 0.74], "cone");
    } else {
      add("brickDark", [x + width * 0.25, y + 0.48, z + depth * 0.2], [0.48, 0.9, 0.58]);
      add("stone", [x + width * 0.25, y + 0.94, z + depth * 0.2], [0.62, 0.12, 0.7]);
    }
  };

  const facade = (
    x: number,
    z: number,
    width: number,
    depth: number,
    base: number,
    height: number,
    index: number,
  ) => {
    const columns = Math.max(2, Math.floor(width / 1.15));
    for (let y = base + 1.1; y < base + height - 0.5; y += 1.45) {
      for (let col = 0; col < columns; col++) {
        const wx = x - width / 2 + ((col + 0.5) * width) / columns;
        const finish = (col + index + Math.floor(y)) % 5 === 0 ? "cityGlass" : "cityWindow";
        for (const face of [-1, 1]) {
          add("stone", [wx, y, z + face * (depth / 2 + 0.025)], [0.68, 1.03, 0.05]);
          add(finish, [wx, y + 0.03, z + face * (depth / 2 + 0.06)], [0.5, 0.81, 0.035]);
        }
      }
      for (let col = 0; col < Math.floor(depth / 1.35); col++) {
        const wz = z - depth / 2 + 0.8 + col * 1.35;
        for (const side of [-1, 1])
          add("cityWindow", [x + side * (width / 2 + 0.025), y, wz], [0.045, 0.84, 0.56]);
      }
    }
    add("stone", [x, base + height - 0.1, z], [width + 0.16, 0.18, depth + 0.12]);
  };

  const building = (
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    finish: Surface,
    index: number,
  ) => {
    add(finish, [x, -10 + height / 2, z], [width, height, depth]);
    facade(x, z, width, depth, -10, height, index);
    roof(x, z, width, depth, height - 10, index);
  };

  add("grout", [0, -10.3, -37], [160, 0.2, 160]);
  for (const z of [-23, -43, -63]) {
    add("iron", [0, -10.16, z], [130, 0.04, 6]);
    for (const side of [-1, 1]) add("stone", [0, -10.08, z + side * 3.5], [130, 0.16, 1]);
  }
  for (const x of [-22, 23]) add("iron", [x, -10.15, -40], [5, 0.05, 70]);

  let rowEdge = -17.5;
  for (const [i, [width, depth, height, finish]] of (
    [
      [3.6, 6.8, 5.6, "brickDark"],
      [4.7, 8.4, 9.8, "brick"],
      [4.1, 7.2, 7.1, "brickLight"],
      [5.2, 7.8, 8.4, "brickDark"],
      [3.7, 8.1, 6.5, "brick"],
      [4.4, 7, 10, "brickLight"],
      [5, 7.6, 7.7, "brick"],
      [3.9, 8.8, 9.2, "brickDark"],
    ] as const
  ).entries()) {
    const x = rowEdge + width / 2;
    rowEdge += width + 0.18;
    const z = -14.5 + (i % 2) * 0.35;
    building(x, z, width, depth, height, finish, i);
    if (i % 2 === 0) {
      const front = z + depth / 2;
      for (let y = -7.8; y < height - 10 - 0.6; y += 1.45) {
        add("iron", [x + 0.8, y, front + 0.4], [1.5, 0.09, 0.75]);
        add("iron", [x + 0.8, y + 0.6, front + 0.75], [1.5, 0.055, 0.05]);
        for (let rail = 0; rail < 5; rail++)
          add("iron", [x + 0.16 + rail * 0.32, y + 0.3, front + 0.75], [0.035, 0.6, 0.04]);
        for (const side of [-1, 1])
          add("iron", [x + 1.35 + side * 0.22, y - 0.72, front + 0.8], [0.04, 1.45, 0.04]);
        for (let rung = 0; rung < 5; rung++)
          add("iron", [x + 1.35, y - rung * 0.29, front + 0.8], [0.44, 0.04, 0.06]);
      }
    }
  }

  for (const [i, [width, height, finish]] of (
    [
      [6.7, 12, "brick"],
      [5.8, 15, "cityStone"],
      [7.1, 13, "brickDark"],
      [6.1, 17, "brickLight"],
      [6.7, 11, "brick"],
      [5.8, 14, "cityStone"],
      [7.1, 16, "brickDark"],
      [6.1, 12, "brickLight"],
      [6.7, 18, "cityStone"],
      [5.8, 13, "brick"],
      [7.1, 15, "brickLight"],
      [6.1, 11, "brickDark"],
    ] as const
  ).entries()) {
    const x = -42 + i * 7.6;
    const z = -33 + ((i % 3) - 1) * 1.5;
    building(x, z, width, 8 + (i % 2), height, finish, i + 8);
    if (i % 3 === 1) {
      add("brickDark", [x, height - 9, z - 1], [width * 0.7, 2, 5.5]);
      roof(x, z - 1, width * 0.7, 5.5, height - 8, i + 1);
    }
  }

  for (const [i, [width, height, finish]] of (
    [
      [7.2, 20, "cityStone"],
      [6.6, 25, "cityGlass"],
      [8, 18, "brickDark"],
      [5.5, 30, "cityStone"],
      [7.2, 23, "cityGlass"],
      [6.6, 33, "brickDark"],
      [8, 21, "cityStone"],
      [5.5, 27, "cityGlass"],
      [7.2, 19, "brickDark"],
      [6.6, 29, "cityStone"],
      [8, 22, "cityGlass"],
    ] as const
  ).entries()) {
    const x = -48 + i * 9.5;
    const z = -53 - (i % 3) * 2;
    const lower = height * 0.64;
    add(finish, [x, -10 + lower / 2, z], [width, lower, 8]);
    facade(x, z, width, 8, -10, lower, i);
    const upper = height - lower;
    add(finish, [x, -10 + lower + upper / 2, z], [width * 0.73, upper, 6]);
    facade(x, z, width * 0.73, 6, lower - 10, upper, i);
    roof(x, z, width * 0.73, 6, height - 10, i);
    if (i % 4 === 1) {
      add("cityStone", [x, height - 8.7, z], [width * 0.4, 2.6, 3.8]);
      add("iron", [x, height - 5.5, z], [0.12, 4, 0.12]);
    }
  }
  return [...batches.values()];
}
