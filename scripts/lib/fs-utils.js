import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync } from "node:fs";

export async function ensureDirFor(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
}

export async function writeJson(filePath, data) {
  await ensureDirFor(filePath);
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export async function readJson(filePath) {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

export function fileExists(filePath) {
  return existsSync(filePath);
}
