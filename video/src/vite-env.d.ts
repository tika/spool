/// <reference types="vite/client" />

declare module "*?scene" {
  import { FullSceneDescription, ThreadGeneratorFactory } from "@revideo/core";
  import { View2D } from "@revideo/2d";
  const scene: FullSceneDescription<ThreadGeneratorFactory<View2D>>;
  export default scene;
}
