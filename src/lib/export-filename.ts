/** Build consistent, human-readable export names using the device's local date and time. */
export function exportFilename(modelName: string, type: "img" | "vid", date = new Date()) {
  const model = modelName.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "VYNESHINDEN";
  const hour = date.getHours();
  const hour12 = hour % 12 || 12;
  const minute = String(date.getMinutes()).padStart(2, "0");
  const suffix = hour < 12 ? "am" : "pm";
  const time = `${hour12}.${minute}${suffix}`;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${model}_${type}_${time}_${month}.${day}.${year}`;
}
