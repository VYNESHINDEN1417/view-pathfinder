import { unzip, strFromU8 } from "fflate";
import library from "@/assets/local-textures.json";

export type ModelArchive = { name: string; obj: string; mtl: string; textures: Map<string, Uint8Array> };
const local = library as Record<string, string>;
export function cleanPath(path: string) {
  const parts: string[] = [];
  for (const p of path.replaceAll("\\", "/").replace(/^['"]|['"]$/g, "").split("/")) {
    if (p === "..") parts.pop(); else if (p && p !== ".") parts.push(p);
  }
  return parts.join("/").toLowerCase();
}
export function blockName(path: string) { return cleanPath(path).split("/").pop()?.replace(/\.(png|jpg|jpeg|bmp|tga)$/i, "") ?? ""; }
export function localTexture(path: string) { return local[blockName(path)]; }
export function findArchiveTexture(files: Map<string, Uint8Array>, path: string, base: string) {
  const exact = files.get(cleanPath(base + path)) ?? files.get(cleanPath(path));
  if (exact) return exact;
  const matches = [...files].filter(([name]) => blockName(name) === blockName(path));
  return matches.length === 1 ? matches[0]?.[1] : undefined;
}
export async function readModelArchive(file: File, notify: (done: number, total: number) => void): Promise<ModelArchive> {
  if (file.size > 150 * 1024 * 1024) throw new Error("Choose a ZIP smaller than 150 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let total = 0;
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => unzip(bytes, {
    filter: (entry) => {
      const allowed = /\.(obj|mtl|png|jpe?g|bmp|tga)$/i.test(entry.name) && !entry.name.includes("__MACOSX");
      if (allowed) total += entry.originalSize;
      if (total > 400 * 1024 * 1024) throw new Error("Unpacked model exceeds 400 MB.");
      return allowed;
    },
  }, (error, result) => error ? reject(new Error("This ZIP could not be opened.")) : resolve(result)));
  const files = new Map(Object.entries(entries).map(([name, data]) => [cleanPath(name), data]));
  const models = [...files.keys()].filter((name) => name.endsWith(".obj"));
  if (models.length !== 1) throw new Error(models.length ? "Include only one OBJ model per ZIP." : "This ZIP contains no OBJ model.");
  const modelPath = models[0];
  if (!modelPath) throw new Error("This ZIP contains no OBJ model.");
  const objData = files.get(modelPath);
  if (!objData) throw new Error("Model could not be read.");
  let obj = strFromU8(objData);
  const base = modelPath.slice(0, modelPath.lastIndexOf("/") + 1);
  const referenced = [...obj.matchAll(/^mtllib\s+(.+)$/gm)].map((m) => m[1]?.trim() ?? "");
  const mtlPaths = referenced.flatMap((name) => {
    const path = cleanPath(base + name);
    if (files.has(path)) return [path];
    const found = [...files.keys()].filter((p) => p.endsWith(".mtl") && p.split("/").pop() === cleanPath(name).split("/").pop());
    return found.length === 1 ? found : [];
  });
  if (!mtlPaths.length) mtlPaths.push(...[...files.keys()].filter((p) => p.endsWith(".mtl")));
  const textures = new Map<string, Uint8Array>();
  const mtls = mtlPaths.map((path) => {
    const data = files.get(path); if (!data) return "";
    const mtlBase = path.slice(0, path.lastIndexOf("/") + 1);
    return strFromU8(data).replace(/^map_Kd\s+(.+)$/gm, (_, name: string) => {
      const resolved = cleanPath(mtlBase + name.trim());
      const texture = findArchiveTexture(files, name.trim(), mtlBase);
      if (texture) textures.set(resolved, texture);
      return "map_Kd " + resolved;
    });
  });
  obj = obj.replace(/^mtllib\s+.+$/gm, "");
  if (mtls.length) obj = "mtllib uploaded.mtl\n" + obj;
  notify(total, total);
  return { name: modelPath.split("/").pop()?.replace(/\.obj$/i, "") ?? "model", obj, mtl: mtls.join("\n"), textures };
}