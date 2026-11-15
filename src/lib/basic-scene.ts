/**
 * A lightweight Minecraft grass-block starter scene for the scene picker.
 * Uses the repository's local grass-top, grass-side, and dirt textures.
 */
export const BASIC_SCENE_OBJ = [
  "mtllib basic-scene.mtl",
  "o Grass_block",
  // Six independently-normaled faces keep the cube edges crisp.
  "v -0.5 -0.5 0.5", "v 0.5 -0.5 0.5", "v 0.5 0.5 0.5", "v -0.5 0.5 0.5",
  "v 0.5 -0.5 -0.5", "v -0.5 -0.5 -0.5", "v -0.5 0.5 -0.5", "v 0.5 0.5 -0.5",
  "v -0.5 -0.5 -0.5", "v -0.5 -0.5 0.5", "v -0.5 0.5 0.5", "v -0.5 0.5 -0.5",
  "v 0.5 -0.5 0.5", "v 0.5 -0.5 -0.5", "v 0.5 0.5 -0.5", "v 0.5 0.5 0.5",
  "v -0.5 0.5 0.5", "v 0.5 0.5 0.5", "v 0.5 0.5 -0.5", "v -0.5 0.5 -0.5",
  "v -0.5 -0.5 -0.5", "v 0.5 -0.5 -0.5", "v 0.5 -0.5 0.5", "v -0.5 -0.5 0.5",
  ...Array.from({ length: 6 }, () => ["vt 0 0", "vt 1 0", "vt 1 1", "vt 0 1"]).flat(),
  "usemtl grass_side",
  "f 1/1 2/2 3/3 4/4", "f 5/5 6/6 7/7 8/8",
  "f 9/9 10/10 11/11 12/12", "f 13/13 14/14 15/15 16/16",
  "usemtl grass_top",
  "f 17/17 18/18 19/19 20/20",
  "usemtl dirt",
  "f 21/21 22/22 23/23 24/24",
].join("\n") + "\n";

export const BASIC_SCENE_MTL = [
  "newmtl grass_side",
  "Kd 1 1 1",
  "map_Kd grass_side.png",
  "newmtl grass_top",
  "Kd 1 1 1",
  "map_Kd grass_top.png",
  "newmtl dirt",
  "Kd 1 1 1",
  "map_Kd dirt.png",
  "",
].join("\n");
