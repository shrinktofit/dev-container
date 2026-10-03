import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import process from 'node:process';
import type { DevContainerMainExtension } from '@bsgames/dev-container-api';

export const vortexMainExtension: DevContainerMainExtension = {
  id: 'vortex',
  activate(ctx) {
    const directory = resolve(ctx.targetDirectory, ctx.runtime.config.client.dir);
    const subpath = ctx.runtime.config.client.subpath;
    ctx.runtime.setPreviewUrlSource(() => readPreviewUrl(directory, subpath));
  },
};

async function readPreviewUrl(directory: string, subpath: string): Promise<string> {
  const file = join(directory, 'temp', 'editor-session.json');
  try {
    const session: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!session || typeof session !== 'object' || Array.isArray(session)) {
      throw new Error('Editor session must be an object.');
    }
    const state = session as Record<string, unknown>;
    if (state.schemaVersion !== 1) {
      throw new Error('Unsupported editor session schemaVersion; expected 1.');
    }
    const port = state['server.port'];
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Invalid server.port; expected an integer between 1 and 65535.');
    }
    const pid = state['editor.pid'];
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid < 1) {
      throw new Error('Invalid editor.pid; expected a positive integer.');
    }
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        throw new Error(
          'Editor process '
          + pid
          + ' is no longer running. Start Vortex for '
          + directory
          + ' and retry.',
          { cause: error },
        );
      }
      throw error;
    }
    const url = new URL('http://localhost:' + port + '/');
    url.pathname = '/' + subpath.replace(/^\/+/u, '');
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    await response.body?.cancel();
    if (!response.ok) {
      throw new Error('Preview server returned HTTP ' + response.status + ': ' + url.href);
    }
    return url.href;
  } catch (error) {
    throw new Error(file + ': ' + (error instanceof Error ? error.message : String(error)), {
      cause: error,
    });
  }
}
