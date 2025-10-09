import path from "node:path";
import fs from "fs-extra";

const REQUIRED_DIRECTORIES = [
  "proto",
  "generated/source",
  "generated/source/messages",
  "fixtures/baseline",
  "roku-app/source",
  "roku-app/components"
];

const REQUIRED_FILES: Record<string, string> = {
  "proto/.gitkeep": "",
  "generated/source/.gitkeep": "",
  "generated/source/messages/.gitkeep": "",
  "fixtures/baseline/.gitkeep": ""
};

export async function ensureWorkspace() {
  const root = process.cwd();

  await Promise.all(
    REQUIRED_DIRECTORIES.map(async (dir) => {
      const absolute = path.join(root, dir);
      await fs.ensureDir(absolute);
    })
  );

  await Promise.all(
    Object.entries(REQUIRED_FILES).map(async ([filePath, contents]) => {
      const absolute = path.join(root, filePath);
      if (!(await fs.pathExists(absolute))) {
        await fs.outputFile(absolute, contents);
      }
    })
  );
}
