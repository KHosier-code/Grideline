import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Orval 8 can emit a nested response's numeric constraints after the schema
// that references them. Keep generated validation behavior, but place those
// literal declarations before the schema so both ESM and TypeScript can load it.
const path = fileURLToPath(new URL("../../api-zod/src/generated/api.ts", import.meta.url));
let source = readFileSync(path, "utf8");
const declarations = [...source.matchAll(/^export const ([A-Za-z]\w*) = (-?\d+(?:\.\d+)?);$/gm)];
const misplaced = declarations.filter((match) =>
  new RegExp(`\\b${match[1]}\\b`).test(source.slice(0, match.index)));

if (misplaced.length) {
  for (const match of misplaced) {
    source = source.replace(`${match[0]}\n`, "");
  }
  const importLine = "import * as zod from 'zod';";
  if (!source.includes(importLine)) throw new Error("Unexpected generated Zod import; cannot hoist constraints");
  source = source.replace(importLine, `${importLine}\n\n${misplaced.map((match) => match[0]).join("\n")}`);
}
writeFileSync(path, source.replace(/\n{2,}$/, "\n"));

for (const relativePath of [
  "../../api-client-react/src/generated/api.ts",
  "../../api-client-react/src/generated/api.schemas.ts",
]) {
  const generatedPath = fileURLToPath(new URL(relativePath, import.meta.url));
  const generated = readFileSync(generatedPath, "utf8");
  writeFileSync(generatedPath, generated.replace(/\n{2,}$/, "\n"));
}