import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  Vector3,
  WebGLRenderer,
} from "three";
import { createGarden } from "./garden-model";

function sunlight(): DirectionalLight {
  const light = new DirectionalLight(0xfff0db, 2.5);
  light.position.set(-3, 9, 5);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  Object.assign(light.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 });
  light.shadow.normalBias = 0.035;
  light.shadow.radius = 3;
  light.shadow.bias = -0.00015;
  return light;
}

export class GardenRenderer {
  private readonly garden = createGarden();
  private readonly sun = sunlight();
  private readonly camera = new PerspectiveCamera(39, 1, 0.1, 140);
  private readonly target = new Vector3();
  private readonly observer = new ResizeObserver(() => this.resize());
  private elapsed = 0;
  private previous = 0;
  private lastDraw = 0;
  private frame = 0;
  private running = false;
  private disposed = false;
  private width = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly renderer: WebGLRenderer,
    private readonly onFailure: () => void,
  ) {
    this.garden.scene.background = new Color(0xd5dbd4);
    this.garden.scene.fog = new Fog(0xd5dbd4, 35, 115);
    this.garden.scene.add(new HemisphereLight(0xf2f1e7, 0x666960, 1.8), this.sun);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.domElement.setAttribute("aria-hidden", "true");
    try {
      this.resize();
      host.append(renderer.domElement);
      renderer.domElement.addEventListener("webglcontextlost", this.lost);
      this.observer.observe(host);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private draw(): void {
    const approach = (1 - Math.cos((this.elapsed / 60) * Math.PI * 2)) / 2;
    const narrow = window.innerWidth < 1024;
    this.target.set(
      narrow ? 0 : -3.8 + 1.4 * approach,
      narrow ? 6.5 - 3.7 * approach : 1.2 + 0.35 * approach,
      -6 + 6.1 * approach,
    );
    this.camera.position.set(8 - 6.2 * approach, 23 - 18.8 * approach, 23 - 13.5 * approach);
    this.camera.lookAt(this.target);
    for (const [index, plant] of this.garden.sway.entries()) {
      plant.rotation.z = Math.sin(this.elapsed * 0.75 + index * 1.7) * 0.018;
      plant.rotation.x = Math.cos(this.elapsed * 0.55 + index) * 0.012;
    }
    this.renderer.render(this.garden.scene, this.camera);
  }

  private resize(): void {
    if (this.disposed) return;
    this.width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!this.width || !height) return;
    const scale = Math.min(
      window.devicePixelRatio,
      1.5,
      Math.sqrt(2_000_000 / (this.width * height)),
    );
    this.renderer.setSize(Math.floor(this.width * scale), Math.floor(height * scale), false);
    this.camera.aspect = this.width / height;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  private tick = (now: number): void => {
    if (!this.running || this.disposed) return;
    this.elapsed += (now - this.previous) / 1000;
    this.previous = now;
    const delta = now - this.lastDraw;
    if (delta >= 1000 / 30) {
      this.lastDraw = now - (delta % (1000 / 30));
      this.draw();
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  setRunning(next: boolean): void {
    if (this.running === next || this.disposed) return;
    this.running = next;
    cancelAnimationFrame(this.frame);
    if (!this.running) return;
    this.previous = performance.now();
    this.lastDraw = this.previous;
    this.frame = requestAnimationFrame(this.tick);
  }

  private lost = (event: Event): void => {
    event.preventDefault();
    this.onFailure();
  };

  dispose(): void {
    this.setRunning(false);
    this.disposed = true;
    this.observer.disconnect();
    this.renderer.domElement.removeEventListener("webglcontextlost", this.lost);
    this.renderer.domElement.remove();
    this.garden.dispose();
    this.sun.shadow.map?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

export function mountGarden(host: HTMLElement, onFailure: () => void): GardenRenderer {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false });
  try {
    return new GardenRenderer(host, renderer, onFailure);
  } catch (error) {
    renderer.dispose();
    throw error;
  }
}
