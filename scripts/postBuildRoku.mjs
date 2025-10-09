import fsExtra from "fs-extra";
import path from "node:path";

const projectRoot = process.cwd();
const stagingDir = path.join(projectRoot, "out");
const rokuAppDir = path.join(stagingDir, "roku-app");
const manifestSource = path.join(rokuAppDir, "manifest");
const manifestTarget = path.join(stagingDir, "manifest");
const rokuSourceDir = path.join(rokuAppDir, "source");
const targetSourceDir = path.join(stagingDir, "source");
const generatedDir = path.join(stagingDir, "generated");

async function copyIfExists(src, dest) {
  if (await fsExtra.pathExists(src)) {
    await fsExtra.ensureDir(path.dirname(dest));
    await fsExtra.copy(src, dest, { overwrite: true });
  }
}

async function main() {
  if (!(await fsExtra.pathExists(stagingDir))) {
    return;
  }

  await copyIfExists(manifestSource, manifestTarget);
  if (await fsExtra.pathExists(rokuSourceDir)) {
    await fsExtra.ensureDir(targetSourceDir);
    await fsExtra.copy(rokuSourceDir, targetSourceDir, { overwrite: true });
  }

  const rokuComponentsDir = path.join(rokuAppDir, "components");
  if (await fsExtra.pathExists(rokuComponentsDir)) {
    const targetComponentsDir = path.join(stagingDir, "components");
    await fsExtra.ensureDir(targetComponentsDir);
    await fsExtra.copy(rokuComponentsDir, targetComponentsDir, { overwrite: true });
  }

  // ensure generated assets stay where expected
  const generatedSourceDir = path.join(stagingDir, "generated", "source");
  if (!(await fsExtra.pathExists(generatedSourceDir))) {
    const altGeneratedDir = path.join(rokuAppDir, "generated");
    if (await fsExtra.pathExists(altGeneratedDir)) {
      await fsExtra.ensureDir(generatedDir);
      await fsExtra.copy(altGeneratedDir, generatedDir, { overwrite: true });
    }
  }

  if (await fsExtra.pathExists(rokuAppDir)) {
    await fsExtra.remove(rokuAppDir);
  }
}

main().catch((error) => {
  console.error("Failed to finalize Roku staging output:", error);
  process.exitCode = 1;
});
