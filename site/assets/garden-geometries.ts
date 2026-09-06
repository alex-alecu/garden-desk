import {
  BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  RepeatWrapping,
} from "three";

export function gableGeometry(): BufferGeometry {
  const a = [-0.5, 0, 0.5],
    b = [0.5, 0, 0.5],
    c = [0, 1, 0.5];
  const d = [-0.5, 0, -0.5],
    e = [0.5, 0, -0.5],
    f = [0, 1, -0.5];
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [
        ...a,
        ...b,
        ...c,
        ...e,
        ...d,
        ...f,
        ...a,
        ...c,
        ...f,
        ...a,
        ...f,
        ...d,
        ...b,
        ...e,
        ...f,
        ...b,
        ...f,
        ...c,
        ...a,
        ...d,
        ...e,
        ...a,
        ...e,
        ...b,
      ],
      3,
    ),
  );
  geometry.computeVertexNormals();
  return geometry;
}

export function waterTexture(): DataTexture {
  const pixels = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const phase = (Math.PI * 2) / 128;
      const value =
        128 +
        Math.sin(x * phase * 4 + Math.sin(y * phase * 2)) * 28 +
        Math.sin((x * 9 + y * 2) * phase) * 12;
      const offset = (y * 128 + x) * 4;
      pixels.set([value, value, value, 255], offset);
    }
  }
  const texture = new DataTexture(pixels, 128, 128);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.repeat.set(12, 12);
  texture.needsUpdate = true;
  return texture;
}
