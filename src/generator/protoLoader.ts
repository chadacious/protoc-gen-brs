import path from "node:path";
import fs from "fs-extra";
import { existsSync } from "node:fs";
import { Root } from "protobufjs";
import * as protobuf from "protobufjs";

export interface ProtoBundle {
  root: Root;
  files: string[];
}

export async function loadProtoBundle(protoPaths: string[]): Promise<ProtoBundle> {
  const { files, searchDirs } = await collectProtoInputs(protoPaths);
  if (files.length === 0) {
    throw new Error("No .proto files found in the provided paths.");
  }

  const root = new Root();

  root.resolvePath = (origin, target) => {
    if (path.isAbsolute(target)) {
      return target;
    }

    const candidates: string[] = [];
    if (origin) {
      candidates.push(path.resolve(path.dirname(origin), target));
    }
    for (const dir of Array.from(searchDirs)) {
      candidates.push(path.resolve(dir, target));
    }
    candidates.push(path.resolve(process.cwd(), target));

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        registerSearchDir(path.dirname(candidate), searchDirs);
        return candidate;
      }
    }

    return candidates[candidates.length - 1];
  };

  try {
    await new Promise<void>((resolve, reject) => {
      root.load(files, { keepCase: true }, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    root.resolveAll();

    return {
      root,
      files: files.map((filePath) => path.relative(process.cwd(), filePath))
    };
  } catch {
    const combined = await buildCombinedProto(files);
    const parsed = protobuf.parse(combined, { keepCase: true }) as { root: Root };
    parsed.root.resolveAll();

    return {
      root: parsed.root,
      files: files.map((filePath) => path.relative(process.cwd(), filePath))
    };
  }
}

async function collectProtoInputs(protoPaths: string[]): Promise<{ files: string[]; searchDirs: Set<string> }> {
  const files = new Set<string>();
  const searchDirs = new Set<string>();

  async function visit(entry: string) {
    const resolved = path.resolve(entry);
    try {
      const stats = await fs.stat(resolved);
      if (stats.isDirectory()) {
        registerSearchDir(resolved, searchDirs);
        const children = await fs.readdir(resolved);
        for (const child of children) {
          if (child.startsWith(".")) {
            continue;
          }
          await visit(path.join(resolved, child));
        }
      } else if (stats.isFile() && resolved.endsWith(".proto")) {
        files.add(resolved);
        registerSearchDir(path.dirname(resolved), searchDirs);
      }
    } catch {
      // ignore paths that cannot be read
    }
  }

  for (const input of protoPaths) {
    await visit(input);
  }

  return {
    files: Array.from(files).sort(),
    searchDirs
  };
}

function registerSearchDir(dir: string, searchDirs: Set<string>) {
  const absolute = path.resolve(dir);
  if (!searchDirs.has(absolute)) {
    searchDirs.add(absolute);
  }
  const parent = path.dirname(absolute);
  if (parent && parent !== absolute && !searchDirs.has(parent)) {
    searchDirs.add(parent);
  }
}

async function buildCombinedProto(files: string[]): Promise<string> {
  let combined = "";
  for (const filePath of files) {
    const contents = await fs.readFile(filePath, "utf8");
    combined += removeImportStatements(contents) + "\n";
  }
  return combined;
}

function removeImportStatements(contents: string): string {
  return contents
    .split(/\r?\n/)
    .filter((line) => line.trim().toLowerCase().startsWith("import ") === false)
    .join("\n");
}
