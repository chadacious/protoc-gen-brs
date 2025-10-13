import fs from 'fs-extra';
import path from 'node:path';

const sourceDir = path.resolve('src', 'templates');
const targetDir = path.resolve('dist', 'templates');

async function main() {
  if (!(await fs.pathExists(sourceDir))) {
    return;
  }
  await fs.copy(sourceDir, targetDir, { overwrite: true });
}

main().catch((error) => {
  console.error('Failed to copy templates:', error);
  process.exitCode = 1;
});
