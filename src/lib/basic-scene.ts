/**
 * A compact, watertight Minecraft grass block for Pathfinder's Empty Scene.
 * Each side uses the repository's complete grass_side_carried texture:
 * a 16x16 dirt face with the green grass edge already baked into the image.
 * The side is one full quad; no separate grass strip or alpha overlay.
 */
type FaceMaterial = "grass_side" | "grass_top" | "dirt";
type Point3 = [number, number, number];

const objFaces: Array<{ material: FaceMaterial; points: [Point3, Point3, Point3, Point3] }> = [];
const addSide = (bottomA: Point3, bottomB: Point3, topB: Point3, topA: Point3) => {
  objFaces.push({
    material: "grass_side",
    points: [bottomA, bottomB, topB, topA],
  });
};

// Four complete outward-facing side walls, each using the baked dirt-and-grass texture.
addSide([-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]);
addSide([0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]);
addSide([-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]);
addSide([0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]);

// Top and bottom caps.
objFaces.push(
  { material: "grass_top", points: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
  { material: "dirt", points: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
);

const objLines = ["mtllib basic-scene.mtl", "o Grass_block"];
let vertexIndex = 1;
let uvIndex = 1;
let activeMaterial: FaceMaterial | null = null;
for (const face of objFaces) {
  for (const [x, y, z] of face.points) objLines.push(`v ${x} ${y} ${z}`);
  objLines.push("vt 0 0", "vt 1 0", "vt 1 1", "vt 0 1");
  if (activeMaterial !== face.material) {
    objLines.push(`usemtl ${face.material}`);
    activeMaterial = face.material;
  }
  const a = vertexIndex, b = vertexIndex + 1, c = vertexIndex + 2, d = vertexIndex + 3;
  const ta = uvIndex, tb = uvIndex + 1, tc = uvIndex + 2, td = uvIndex + 3;
  objLines.push(`f ${a}/${ta} ${b}/${tb} ${c}/${tc}`);
  objLines.push(`f ${a}/${ta} ${c}/${tc} ${d}/${td}`);
  vertexIndex += 4;
  uvIndex += 4;
}

export const BASIC_SCENE_OBJ = objLines.join("\n") + "\n";

export const BASIC_SCENE_MTL = [
  "newmtl grass_side",
  "Kd 1 1 1",
  "map_Kd grass_side_carried.png",
  "newmtl grass_top",
  // Vanilla grass_top.png is a grayscale biome mask; tint it green for the plains look.
  "Kd 0.62 0.70 0.50",
  "map_Kd grass_top.png",
  "newmtl dirt",
  "Kd 1 1 1",
  "map_Kd dirt.png",
  "",
].join("\n");
