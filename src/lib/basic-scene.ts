/**
 * A compact, watertight Minecraft-style grass block for Pathfinder's Empty Scene.
 * Side walls are split into a green turf band and a dirt body so biome tinting
 * does not recolor the dirt. Every quad is explicitly triangulated for the WASM OBJ parser.
 */
type FaceMaterial = "grass_side" | "grass_top" | "dirt";
type Point3 = [number, number, number];

const objFaces: Array<{ material: FaceMaterial; points: [Point3, Point3, Point3, Point3] }> = [];
const addSide = (bottomA: Point3, bottomB: Point3, topB: Point3, topA: Point3) => {
  const bandY = 0.375;
  const lowerA: Point3 = [bottomA[0], -0.5, bottomA[2]];
  const lowerB: Point3 = [bottomB[0], -0.5, bottomB[2]];
  const upperA: Point3 = [topA[0], bandY, topA[2]];
  const upperB: Point3 = [topB[0], bandY, topB[2]];
  objFaces.push(
    { material: "dirt", points: [lowerA, lowerB, upperB, upperA] },
    { material: "grass_side", points: [upperA, upperB, topB, topA] },
  );
};

// Four outward-facing walls, each continuous from the bottom to the turf cap.
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

export const BASIC_SCENE_OBJ = objLines.join("\\n") + "\\n";

export const BASIC_SCENE_MTL = [
  "newmtl grass_side",
  "Kd 0.38 0.78 0.24",
  "map_Kd grass_top.png",
  "newmtl grass_top",
  "Kd 0.38 0.78 0.24",
  "map_Kd grass_top.png",
  "newmtl dirt",
  "Kd 1 1 1",
  "map_Kd dirt.png",
  "",
].join("\\n");
