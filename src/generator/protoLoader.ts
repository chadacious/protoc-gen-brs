import path from "node:path";
import fs from "fs-extra";
import { Root } from "protobufjs";

export interface ProtoBundle {
  root: Root;
  files: string[];
}

export async function loadProtoBundle(protoPaths: string[]): Promise<ProtoBundle> {
  const root = new Root();
  const resolvedFiles = await expandProtoPaths(protoPaths);

  await Promise.all(
    resolvedFiles.map(async (filePath) => {
      const absolute = path.resolve(filePath);
      await root.load(absolute, { keepCase: true });
    })
  );

  root.resolveAll();

  return {
    root,
    files: resolvedFiles.map((filePath) => path.relative(process.cwd(), path.resolve(filePath)))
  };
}

async function expandProtoPaths(protoPaths: string[]): Promise<string[]> {
  const results: string[] = [];

  for (const item of protoPaths) {
    const resolved = path.resolve(item);
    const stats = await fs.stat(resolved);

    if (stats.isDirectory()) {
      const entries = await fs.readdir(resolved);
      for (const entry of entries) {
        if (entry.startsWith(".")) {
          continue;
        }
        const candidate = path.join(resolved, entry);
        const entryStats = await fs.stat(candidate);
        if (entryStats.isDirectory()) {
          const nested = await expandProtoPaths([candidate]);
          results.push(...nested);
        } else if (entry.endsWith(".proto")) {
          results.push(candidate);
        }
      }
    } else if (stats.isFile() && resolved.endsWith(".proto")) {
      results.push(resolved);
    }
  }

  return Array.from(new Set(results)).sort();
}
