import { spawn } from 'node:child_process';
import {
  mkdir,
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
const distDir = join(deployRoot, 'dist');

type BuildMode = 'dir' | 'zip';

function assertInside(parent: string, target: string): void {
  const relativePath = relative(parent, target);

  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    return;
  }

  throw new Error(`Refusing to touch path outside ${parent}: ${target}`);
}

function getBuildMode(argv: string[]): BuildMode {
  if (argv.includes('--zip')) {
    return 'zip';
  }

  return 'dir';
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
  const mode = getBuildMode(process.argv.slice(2));
  const builderTargetArgs = mode === 'zip'
    ? [
      '--win',
      'zip',
      '--x64',
    ]
    : ['--dir'];

  assertInside(deployRoot, distDir);
  await mkdir(deployRoot, {
    recursive: true,
  });
  await rm(distDir, {
    force: true,
    recursive: true,
  });

  await run('pnpm', [
    '--dir',
    workspaceRoot,
    '--filter',
    '@bsgames/dev-container-api',
    '--filter',
    '@bsgames/dev-container-sdk',
    '--filter',
    '@bsgames/dev-container-extension-account',
    '--filter',
    '--filter',
    '@bsgames/dev-container-extension-vortex',
    '--filter',
    '@bsgames/dev-container-extension-client-simulator',
    '--filter',
    '@bsgames/dev-container-extension-logs',
    '--filter',
    '@bsgames/dev-container-extension-monitor',
    '--filter',
    '@bsgames/dev-container-extension-room',
    '--filter',
    '@bsgames/dev-container',
    'run',
    'build',
  ], workspaceRoot);

  await run('node', [
    '--run',
    'deploy:stage',
  ], packageRoot);

  await run('pnpm', [
    'exec',
    'electron-builder',
    '--projectDir',
    stagingDir,
    '--config',
    'electron-builder.yml',
    ...builderTargetArgs,
  ], packageRoot);
}

await main();
