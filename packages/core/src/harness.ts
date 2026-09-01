import { createFacade, type GardenDeskCore, type GardenDeskCorePorts } from "./facade.js";

export function createGardenDeskCoreHarness(ports: GardenDeskCorePorts): GardenDeskCore {
  return createFacade(ports);
}
