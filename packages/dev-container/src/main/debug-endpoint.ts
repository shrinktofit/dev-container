import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { DevContainerDebugInfo } from '@bsgames/dev-container-api';

export async function readDebugEndpoint(port: number | undefined): Promise<DevContainerDebugInfo> {
  if (port === undefined) {
    return {};
  }
  if (port !== 0) {
    const origin = 'http://127.0.0.1:' + port;
    const response = await fetch(origin + '/json/version', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      throw new Error('Remote debugging returned HTTP ' + response.status);
    }
    return { remoteDebuggingPort: port, devtoolsHttpOrigin: origin };
  }
  const file = join(app.getPath('sessionData'), 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt++) {
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(file + ': ' + String(error), { cause: error });
      }
      await new Promise<void>((accept) => setTimeout(accept, 100));
      continue;
    }
    const [value, endpoint] = content.trim().split(/\r?\n/u);
    const actualPort = Number(value);
    if (
      !Number.isInteger(actualPort)
      || actualPort < 1
      || actualPort > 65535
      || !endpoint?.startsWith('/devtools/browser/')
    ) {
      throw new Error(file + ': Invalid DevTools endpoint.');
    }
    const origin = 'http://127.0.0.1:' + actualPort;
    const response = await fetch(origin + '/json/version', { signal: AbortSignal.timeout(10000) });
    const version = (await response.json()) as { webSocketDebuggerUrl?: string };
    if (
      !response.ok
      || !version.webSocketDebuggerUrl
      || new URL(version.webSocketDebuggerUrl).pathname !== endpoint
    ) {
      throw new Error(file + ': DevTools endpoint does not match the current browser.');
    }
    return { remoteDebuggingPort: actualPort, devtoolsHttpOrigin: origin };
  }
  throw new Error(file + ': Timed out waiting for the remote debugging endpoint.');
}
