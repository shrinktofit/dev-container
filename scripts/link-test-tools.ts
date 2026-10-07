import { lstatSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';

const shared = createRequire(
  (process.env.DEV_CONTAINER_PLAYWRIGHT_ROOT ?? 'U:/AgentTools/playwright') + '/package.json',
);
const packageDirectory = dirname(shared.resolve('playwright/package.json'));
const modulesDirectory = join(import.meta.dirname, '../test/node_modules');
const packageLink = join(modulesDirectory, 'playwright');
mkdirSync(modulesDirectory, { recursive: true });
if (lstatSync(packageLink, { throwIfNoEntry: false })?.isSymbolicLink()) {
  unlinkSync(packageLink);
}
symlinkSync(packageDirectory, packageLink, process.platform === 'win32' ? 'junction' : 'dir');
