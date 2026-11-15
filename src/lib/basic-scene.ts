/**
 * A lightweight, single-block starter scene for the scene picker.
 * Uses the repository's local Minecraft dirt texture; no extra asset download is needed.
 */
export const BASIC_SCENE_OBJ = [
  "mtllib basic-scene.mtl",
  "o Dirt_block",
  // Six independently-normaled faces keep the cube edges crisp.
  "v -0.5 -0.5 0.5", "v 0.5 -0.5 0.5", "v 0.5 0.5 0.5", "v -0.5 0.5 0.5",
  "v 0.5 -0.5 -0.5", "v -0.5 -0.5 -0.5", "v -0.5 0.5 -0.5", "v 0.5 0.5 -0.5",
  "v -0.5 -0.5 -0.5", "v -0.5 -0.5 0.5", "v -0.5 0.5 0.5", "v -0.5 0.5 -0.5",
  "v 0.5 -0.5 0.5", "v 0.5 -0.5 -0.5", "v 0.5 0.5 -0.5", "v 0.5 0.5 0.5",
  "v -0.5 0.5 0.5", "v 0.5 0.5 0.5", "v 0.5 0.5 -0.5", "v -0.5 0.5 -0.5",
  "v -0.5 -0.5 -0.5", "v 0.5 -0.5 -0.5", "v 0.5 -0.5 0.5", "v -0.5 -0.5 0.5",
  ...Array.from({ length: 6 }, () => ["vt 0 0", "vt 1 0", "vt 1 1", "vt 0 1"]).flat(),
  "usemtl dirt",
  "f 1/1 2/2 3/3 4/4", "f 5/5 6/6 7/7 8/8",
  "f 9/9 10/10 11/11 12/12", "f 13/13 14/14 15/15 16/16",
  "f 17/17 18/18 19/19 20/20", "f 21/21 22/22 23/23 24/24",
].join("\n") + "\n";

export const BASIC_SCENE_MTL = "newmtl dirt\nKd 1 1 1\nmap_Kd dirt.png\n";
