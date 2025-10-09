import path from "node:path";
import { createPackage } from "roku-deploy";

const projectRoot = process.cwd();
const rootDir = path.join(projectRoot, "out");

async function main() {
  await createPackage({
    rootDir,
    files: [
      "manifest",
      "source/**/*",
      "generated/source/**/*"
    ],
    stagingDir: path.join(rootDir, ".roku-deploy-staging"),
    outDir: rootDir,
    outFile: "channel.zip",
    retainStagingDir: false
  });
}

main().catch((error) => {
  console.error("Failed to package Roku channel:", error);
  process.exitCode = 1;
});
