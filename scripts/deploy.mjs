import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "dist");
const target = path.join(root, "dags");

await mkdir(target, { recursive: true });
const bundles = (await readdir(source)).filter((name) => name.endsWith(".min.mjs"));
if (bundles.length === 0) {
  console.error(`No *.min.mjs bundles in ${source}. Run "npm run build" first.`);
  process.exit(1);
}
for (const name of bundles) {
  await copyFile(path.join(source, name), path.join(target, name));
  console.log(`deployed ${name} to ${path.relative(root, target)}`);
}
