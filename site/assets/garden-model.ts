import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

import { createCity } from "./garden-city";
import { gableGeometry, waterTexture } from "./garden-geometries";

type Point = [number, number, number];
const colors = {
  wood: 0x806047,
  grain: 0x644b38,
  timber: 0x756553,
  cream: 0xeee6cd,
  stone: 0xc3c1b6,
  grout: 0x777b72,
  soil: 0x394431,
  brick: 0x915744,
  brickLight: 0xba8665,
  brickDark: 0x594139,
  iron: 0x333b37,
  glass: 0x698b7b,
  screen: 0xd9e6ce,
  leaf: 0x46604a,
  leafLight: 0x657c55,
  leafDark: 0x344e3a,
  pot: 0x656b63,
  cityStone: 0xa5a498,
  cityGlass: 0x607b81,
  cityWindow: 0x354f51,
  roofTile: 0x995e43,
  roofSlate: 0x515b60,
  water: 0x548589,
  waterLight: 0x89b2b0,
};
type Surface = keyof typeof colors;

class GardenModel {
  readonly scene = new Scene();
  readonly sway: Group[] = [];
  private readonly water = waterTexture();
  private readonly materials = Object.fromEntries(
    Object.entries(colors).map(([name, color]) => [
      name,
      new MeshStandardMaterial({
        color,
        roughness: name === "water" ? 0.32 : name === "wood" ? 0.58 : 0.85,
        bumpMap: name === "water" ? this.water : null,
        bumpScale: 0.12,
      }),
    ]),
  ) as Record<Surface, MeshStandardMaterial>;
  private readonly shapes = {
    box: new BoxGeometry(1, 1, 1),
    round: new RoundedBoxGeometry(1, 1, 1, 2, 0.065),
    leaf: new SphereGeometry(1, 8, 4),
    gable: gableGeometry(),
    cylinder: new CylinderGeometry(0.85, 1, 1, 12),
    handle: new TorusGeometry(0.12, 0.025, 6, 14),
  };

  box(surface: Surface, at: Point, size: Point, parent: Group | Scene = this.scene): Mesh {
    const mesh = new Mesh(this.shapes.box, this.materials[surface]);
    mesh.position.set(...at);
    mesh.scale.set(...size);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  rounded(surface: Surface, at: Point, size: Point, parent: Group | Scene = this.scene): Mesh {
    const mesh = this.box(surface, at, size, parent);
    mesh.geometry = this.shapes.round;
    return mesh;
  }

  cylinder(surface: Surface, at: Point, size: Point, parent: Group | Scene = this.scene): Mesh {
    const mesh = this.box(surface, at, size, parent);
    mesh.geometry = this.shapes.cylinder;
    return mesh;
  }

  crown(at: Point, size: Point, count: number, seed: number): void {
    const group = new Group();
    group.position.set(...at);
    this.scene.add(group);
    this.sway.push(group);
    const transform = new Object3D();
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (const surface of ["leaf", "leafLight", "leafDark"] as const) {
      const leaves = new InstancedMesh(this.shapes.leaf, this.materials[surface], count);
      for (let i = 0; i < count; i++) {
        const angle = next() * Math.PI * 2;
        const height = next() * 2 - 1;
        const radius = Math.sqrt(1 - height * height) * Math.cbrt(next());
        transform.position.set(
          Math.cos(angle) * radius * size[0],
          height * size[1],
          Math.sin(angle) * radius * size[2],
        );
        transform.rotation.set(next() * 1.2, next() * 6.28, next() * 1.4 - 0.7);
        const length = 0.035 + next() * 0.03;
        transform.scale.set(length * 0.6, length * 0.07, length);
        transform.updateMatrix();
        leaves.setMatrixAt(i, transform.matrix);
      }
      leaves.castShadow = true;
      leaves.receiveShadow = true;
      group.add(leaves);
    }
  }

  ground(): void {
    this.box("brickDark", [0, -5, -0.3], [7.1, 10, 13.6]);
    this.box("cream", [0, -0.2, -0.3], [7.6, 0.25, 13.9]);
    for (const y of [-2.2, -4.8, -7.4]) {
      this.box("stone", [0, y - 1.05, -0.3], [7.2, 0.1, 13.7]);
      for (const x of [-2.35, 0, 2.35]) {
        this.box("cream", [x, y, 6.53], [1.12, 1.8, 0.1]);
        this.box("cityWindow", [x, y, 6.6], [0.87, 1.55, 0.04]);
        this.box("cream", [x, y + 0.18, 6.63], [0.89, 0.06, 0.035]);
        this.box("cream", [x, y, 6.63], [0.055, 1.56, 0.035]);
      }
      for (const z of [-4.8, -1.8, 1.2, 4.2]) {
        this.box("cream", [3.58, y, z], [0.1, 1.8, 1.1]);
        this.box("cityWindow", [3.65, y, z], [0.04, 1.55, 0.87]);
      }
    }
    const roof = this.box("roofTile", [0, -0.02, -6.12], [7.2, 1.7, 1.6]);
    roof.geometry = this.shapes.gable;
    this.box("grout", [0, 0, 0.7], [5.4, 0.1, 8]);
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 5; col++)
        this.box("stone", [-2.16 + col * 1.08, 0.065, -2.6 + row * 1.3], [1.06, 0.08, 1.285]);
    }
  }

  walls(): void {
    this.box("stone", [0, 0.6, 6.2], [7.3, 1.2, 0.3]);
    this.box("cream", [0, 1.22, 6.2], [7.5, 0.12, 0.4]);
    this.box("stone", [0, 1.15, -5], [7.2, 2.3, 0.3]);
    for (let i = 0; i < 14; i++) this.box("wood", [0, 0.17 + i * 0.17, -4.79], [7.1, 0.15, 0.07]);
    for (const side of [-1, 1]) {
      this.box("stone", [side * 3.55, 0.7, 0.6], [0.3, 1.4, 11.4]);
      this.box("cream", [side * 3.55, 1.42, 0.6], [0.4, 0.12, 11.4]);
    }
  }

  entrance(): void {
    this.box("stone", [0, 1.43, -4.3], [1.65, 2.86, 2]);
    this.box("roofSlate", [0, 2.94, -4.3], [1.85, 0.16, 2.2]);
    this.box("cream", [0, 1.28, -3.265], [1.15, 2.5, 0.1]);
    this.box("leafDark", [0, 1.28, -3.2], [0.97, 2.32, 0.04]);
    this.box("cityGlass", [0, 1.75, -3.17], [0.73, 0.92, 0.025]);
    this.box("iron", [0.33, 1.12, -3.12], [0.16, 0.04, 0.07]);
    this.box("stone", [0, 0.11, -2.99], [1.35, 0.22, 0.6]);
  }

  city(): void {
    const transform = new Object3D();
    for (const { surface, shape, pieces } of createCity()) {
      const blocks = new InstancedMesh(this.shapes[shape], this.materials[surface], pieces.length);
      for (const [index, piece] of pieces.entries()) {
        transform.position.set(...piece.at);
        transform.scale.set(...piece.size);
        transform.rotation.set(...piece.turn);
        transform.updateMatrix();
        blocks.setMatrixAt(index, transform.matrix);
      }
      blocks.receiveShadow = true;
      this.scene.add(blocks);
    }
  }

  tree(x: number, z: number, seed: number): void {
    this.cylinder("timber", [x, 1.85, z], [0.075, 2.5, 0.075]);
    for (let i = 0; i < 6; i++) {
      const angle = i * 2.4;
      const reach = 0.55 + (i % 3) * 0.12;
      const dx = Math.cos(angle) * reach;
      const dz = Math.sin(angle) * reach;
      const y = 2.05 + i * 0.16;
      const direction = new Vector3(dx, 0.6, dz);
      const branch = this.cylinder(
        "timber",
        [x + dx / 2, y + 0.3, z + dz / 2],
        [0.025, direction.length(), 0.025],
      );
      branch.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
      this.crown([x + dx, y + 0.65, z + dz], [0.65, 0.48, 0.6], 160, seed + i);
    }
  }

  plants(): void {
    for (const x of [-2, 2]) {
      this.box("pot", [x, 0.36, -3.85], [2.2, 0.72, 1.2]);
      this.box("soil", [x, 0.725, -3.85], [1.95, 0.025, 0.96]);
    }
    for (const i of [0, 1, 3, 4])
      this.crown([-2.2 + i * 1.1, 1.24, -3.85], [0.48, 0.38, 0.45], 140, 190 + i);
    for (const side of [-1, 1]) {
      this.box("pot", [side * 2.85, 0.33, 0.3], [0.9, 0.66, 8.1]);
      this.box("soil", [side * 2.85, 0.665, 0.3], [0.66, 0.025, 7.86]);
      this.tree(side * 2.85, -2.8, side + 50);
      for (let i = 0; i < 3; i++)
        this.crown([side * 2.85, 1.04, i * 1.6], [0.42, 0.3, 0.56], 100, i + side + 80);
    }
  }

  desk(): void {
    const desk = new Group();
    desk.position.set(0, 0.15, 0.6);
    this.scene.add(desk);
    this.rounded("wood", [0, 1.42, 0], [3.2, 0.17, 1.48], desk);
    for (let i = 0; i < 8; i++)
      this.box("grain", [0, 1.506, -0.63 + i * 0.18], [3.02, 0.003, 0.007], desk);
    for (const x of [-1.32, 1.32]) {
      for (const z of [-0.52, 0.52]) this.rounded("wood", [x, 0.67, z], [0.13, 1.34, 0.13], desk);
      this.box("grain", [x, 0.38, 0], [0.12, 0.1, 1.18], desk);
    }
    this.box("grain", [0, 1.24, 0.57], [2.75, 0.2, 0.08], desk);
    this.equipment(desk);
    this.cylinder("cream", [1.05, 1.66, 0.07], [0.13, 0.28, 0.13], desk);
    this.cylinder("grain", [1.05, 1.805, 0.07], [0.102, 0.006, 0.102], desk);
    const handle = new Mesh(this.shapes.handle, this.materials.cream);
    handle.position.set(1.19, 1.66, 0.07);
    desk.add(handle);
    this.rounded("leafDark", [-1.08, 1.56, -0.13], [0.43, 0.07, 0.58], desk);
    this.rounded("cream", [-1.06, 1.625, -0.12], [0.4, 0.06, 0.54], desk);
    this.chair(desk);
  }

  private equipment(desk: Group): void {
    this.rounded("iron", [-0.1, 1.55, -0.18], [0.58, 0.055, 0.38], desk);
    this.box("iron", [-0.1, 1.77, -0.3], [0.07, 0.43, 0.08], desk);
    this.rounded("iron", [-0.1, 2.13, -0.3], [1.28, 0.82, 0.075], desk);
    this.rounded("screen", [-0.1, 2.15, -0.255], [1.18, 0.7, 0.022], desk);
    for (let i = 0; i < 5; i++)
      this.rounded(
        "leaf",
        [-0.26 + (i % 2) * 0.04, 2.35 - i * 0.09, -0.239],
        [0.65 + (i % 2) * 0.08, i === 0 ? 0.035 : 0.014, 0.007],
        desk,
      );
    this.rounded("cream", [-0.1, 1.54, 0.39], [0.92, 0.04, 0.28], desk);
    this.rounded("cream", [0.57, 1.55, 0.38], [0.14, 0.055, 0.2], desk);
  }

  chair(parent: Group): void {
    const chair = new Group();
    chair.position.set(0.5, 0, 1.55);
    chair.rotation.y = Math.PI - 0.13;
    parent.add(chair);
    this.rounded("wood", [0, 0.76, 0], [0.77, 0.12, 0.72], chair);
    this.rounded("cream", [0, 0.85, 0], [0.67, 0.1, 0.62], chair);
    for (const x of [-0.29, 0.29]) {
      for (const z of [-0.27, 0.27]) this.box("wood", [x, 0.37, z], [0.07, 0.74, 0.07], chair);
      this.box("wood", [x, 1.23, -0.29], [0.065, 0.8, 0.065], chair);
    }
    this.rounded("wood", [0, 1.55, -0.3], [0.78, 0.31, 0.09], chair);
  }

  dispose(): void {
    this.scene.traverse((object) => {
      if (object instanceof InstancedMesh) object.dispose();
    });
    for (const geometry of Object.values(this.shapes)) geometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    this.water.dispose();
  }
}

export function createGarden(): GardenModel {
  const garden = new GardenModel();
  garden.city();
  garden.ground();
  garden.walls();
  garden.entrance();
  garden.plants();
  garden.desk();
  return garden;
}
