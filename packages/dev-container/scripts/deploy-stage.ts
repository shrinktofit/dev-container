import { spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  readdir,
  rm,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(packageRoot, '../..');
const deployRoot = join(packageRoot, '.deploy');
const stagingDir = join(deployRoot, 'staging');
const templateDir = join(packageRoot, 'deploy-template');
const buildResourcesDir = join(packageRoot, 'build-resources');

function assertInside(parent: string, target: string): void {
  const relativePath = relative(parent, target);

  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    return;
  }

  throw new Error(`Refusing to touch path outside ${parent}: ${target}`);
}

async function removeDeployPath(target: string): Promise<void> {
  assertInside(deployRoot, target);
  await rm(target, {
    force: true,
    recursive: true,
  });
}

async function cleanOldDeployArtifacts(): Promise<void> {
  await mkdir(deployRoot, {
    recursive: true,
  });

  await Promise.all([
    removeDeployPath(stagingDir),
    removeDeployPath(join(deployRoot, 'stage')),
    removeDeployPath(join(deployRoot, 'deploy-stage')),
    removeDeployPath(join(deployRoot, 'deploy-stage-hoisted')),
  ]);

  const deployEntries = await readdir(deployRoot, {
    withFileTypes: true,
  });

  await Promise.all(deployEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tgz'))
    .map((entry) => removeDeployPath(join(deployRoot, entry.name))));
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} failed with ${signal ?? code}`));
    });
  });
}

async function main(): Promise<void> {
  await cleanOldDeployArtifacts();

  await run('pnpm', [
    '--dir',
    workspaceRoot,
    '--filter',
    '@bsgames/dev-container',
    '--prod',
    '--config.node-linker=hoisted',
    'deploy',
    '--legacy',
    stagingDir,
  ], workspaceRoot);

  await cp(templateDir, stagingDir, {
    force: true,
    recursive: true,
  });

  await cp(buildResourcesDir, join(stagingDir, 'build-resources'), {
    force: true,
    recursive: true,
  });

  console.log(`DevContainer staging ready: ${stagingDir}`);
}

await main();
