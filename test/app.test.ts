import CDP from 'chrome-remote-interface';
import { gzipSync } from 'node:zlib';
import process from 'node:process';
import { test, type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import type { Client as CdpClient, Target } from 'chrome-remote-interface';
import type { DebugSession, NativeWindow, UserFile, WindowLayout } from './fixture-types.ts';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const require = createRequire(root + '/packages/dev-container/package.json');
const sleep = (ms: number) => new Promise((accept) => setTimeout(accept, ms));

async function until<T>(
  check: () => T | Promise<T>,
  description: string,
): Promise<Exclude<T, undefined | null | false>> {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) {
      return value as Exclude<T, undefined | null | false>;
    }
    await sleep(100);
  }
  throw new Error('Timed out: ' + description);
}

const launchSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['count'],
  properties: {
    '--enabled': {
      type: 'boolean',
      title: 'Enabled',
      default: false,
    },
    'count': {
      type: 'integer',
      default: 0,
      minimum: 0,
      maximum: 10,
    },
    'custom': { type: 'string', maxLength: 8 },
    'choice': {
      type: 'string',
      enum: ['one', 'two'],
      default: 'one',
    },
  },
};

function configText(_mode: string, gameId = 'app-test') {
  return JSON.stringify({
    version: 1,
    game: { id: gameId, title: 'App test' },
    client: { dir: 'client', subpath: 'game' },
    launch: { schema: 'launch-params.schema.json' },
  });
}

function prepareLaunchFiles(game: string, mode: string) {
  writeFileSync(join(game, 'launch-params.schema.json'), JSON.stringify(launchSchema));
  mkdirSync(join(game, '.dev-container'), { recursive: true });
  writeFileSync(
    join(game, '.dev-container/preference.json'),
    JSON.stringify({
      version: 1,
      viewHost: mode,
      layout: 'saved',
      saveLayout: true,
    }),
  );
}

function writeEditorSession(game: string, port: number, directory = 'client', pid = process.pid) {
  const temp = resolve(game, directory, 'temp');
  mkdirSync(temp, { recursive: true });
  writeFileSync(
    join(temp, 'editor-session.json'),
    JSON.stringify({
      'schemaVersion': 1,
      'server.port': port,
      'editor.pid': pid,
    }),
  );
}

async function start(
  game: string,
  t: TestContext,
  packaged = process.env.DEV_CONTAINER_TEST_PACKAGED === '1',
  visible = false,
) {
  const env = {
    ...process.env,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const binary: string = packaged
    ? root + '/packages/dev-container/.deploy/dist/win-unpacked/Dev Container.exe'
    : require('electron');
  const args = packaged
    ? [
      '--game',
      game,
      '--remote-debugging-port=0',
    ]
    : [
      root + '/packages/dev-container',
      '--game',
      game,
      '--remote-debugging-port=0',
    ];
  const child = spawn(binary, args, {
    cwd: root,
    env,
    windowsHide: !visible,
    stdio: [
      'ignore',
      'pipe',
      'pipe',
    ],
  });
  let logs = '';
  child.stdout.on('data', (data) => (logs += data));
  child.stderr.on('data', (data) => (logs += data));
  const sessions = new Map<string, CdpClient>();
  let browser: Browser | undefined = undefined;
  let stopped = false;
  const stop = async () => {
    if (stopped) {
      return;
    }
    stopped = true;
    for (const session of sessions.values()) {
      await session.close().catch(() => {
      });
    }
    sessions.clear();
    if (browser) {
      await browser.close().catch(() => {
      });
    }
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      if (process.platform === 'win32') {
        spawnSync('taskkill.exe', [
          '/PID',
          String(child.pid),
          '/T',
          '/F',
        ], { windowsHide: true });
      } else {
        child.kill();
      }
      await exited;
    }
  };
  t.after(stop);
  const debugEndpoint = await until(
    () => /DevTools listening on (ws:\/\/[^\s]+)/u.exec(logs)?.[1],
    'debug target',
  ).catch((error) => {
    throw new Error('Exit ' + child.exitCode + ': ' + logs, { cause: error });
  });
  const debugOrigin = new URL(debugEndpoint.replace(/^ws/u, 'http')).origin;
  await until(async () => {
    const targets = (await (await fetch(debugOrigin + '/json/list')).json()) as Target[];
    return targets.some(
      (target) => target.type === 'page' && /index\.html|^data:/u.test(target.url),
    );
  }, 'loaded host target');
  const connectedBrowser = await chromium.connectOverCDP(debugEndpoint, { timeout: 60000 });
  browser = connectedBrowser;
  const page = await until(
    () =>
      connectedBrowser
        .contexts()
        .flatMap((context) => context.pages())
        .find((page) => /index\.html|^data:/u.test(page.url())),
    'host page',
  );
  await page.waitForLoadState('domcontentloaded');
  page.on('pageerror', (error) => {
    logs += '\nRenderer: ' + String(error);
  });

  async function descriptors() {
    try {
      const debug = JSON.parse(
        readFileSync(game + '/.dev-container/debug-session.json', 'utf8'),
      ) as DebugSession;
      if (debug.pid !== child.pid) {
        return [];
      }
      const clients = debug.clients;
      const ids = await page
        .locator('.client-panel')
        .evaluateAll((panels) => panels.map((panel) => (panel as HTMLElement).dataset.clientId));
      return clients.sort((a, b) => ids.indexOf(a.clientId) - ids.indexOf(b.clientId));
    } catch {
      return [];
    }
  }

  async function client(index: number | string = 0) {
    const descriptor = await until(async () => {
      const clients = await descriptors();
      return typeof index === 'number'
        ? clients[index]
        : clients.find((client) => client.clientId === index);
    }, 'client ' + index);
    if (descriptor.viewHost === 'iframe') {
      const frame = await until(
        () => page.frames().find((frame) => frame.url() === descriptor.frameUrl),
        'iframe ' + index,
      );
      await until(() => frame.evaluate(() => window.sdkReady || window.sdkError), 'SDK login');
      const error = await frame.evaluate(() => window.sdkError);
      if (error) {
        throw new Error(error);
      }
      return {
        descriptor,
        async evaluate<R>(fn: () => R | Promise<R>): Promise<R> {
          return frame.evaluate(fn);
        },
      };
    }
    const target = await until(
      async () =>
        ((await (await fetch(debugOrigin + '/json/list')).json()) as Target[]).find(
          (target) => target.url === descriptor.url,
        ),
      'guest ' + index,
    ).catch(async (error) => {
      console.log(
        'MISSING GUEST',
        descriptor,
        await (await fetch(debugOrigin + '/json/list')).json(),
        await page.getByRole('alert').allTextContents(),
        logs,
      );
      throw error;
    });
    let session = sessions.get(descriptor.token);
    if (!session) {
      session = await CDP({
        target: target.webSocketDebuggerUrl,
      });
      sessions.set(descriptor.token, session);
      session.on('disconnect', () => sessions.delete(descriptor.token));
    }
    const guestSession = session;
    const evaluate = async <R>(fn: () => R | Promise<R>): Promise<R> => {
      const result = await guestSession.Runtime.evaluate({
        expression: '(' + fn.toString() + ')()',
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
        );
      }
      return result.result.value as R;
    };
    await until(() => evaluate(() => window.sdkReady || window.sdkError), 'guest SDK login');
    const error = await evaluate(() => window.sdkError);
    if (error) {
      throw new Error(error);
    }
    return {
      descriptor,
      evaluate,
    };
  }

  return {
    page,
    child,
    stop,
    client,
    descriptors,
    logs: () => logs,
    async close() {
      const exited = once(child, 'exit');
      nativeWindowAction(child.pid!, 'close');
      await Promise.race([
        exited,
        sleep(10000).then(() => {
          throw new Error('Native close did not exit.');
        }),
      ]);
      await stop();
    },
  };
}

for (const mode of ['webview', 'iframe']) {
  await test(
    mode + ' app account, multiple clients, form and persistence',
    {
      timeout: 360000,
    },
    async (t) => {
      /// @case A real Electron host previews a game that imports the built public ESM SDK.
      /// @expect ID-only login, user switching, launch forms and host state persistence work in
      /// both view types.
      const server = createServer((req, res) => {
        if (req.url!.startsWith('/socket.io/probe')) {
          res.setHeader('access-control-allow-origin', '*');
          res.end(String(req.socket.localPort));
          return;
        }
        if (req.url!.startsWith('/sdk/')) {
          res.setHeader('content-type', 'application/javascript');
          res.setHeader('content-encoding', 'gzip');
          res.end(
            gzipSync(
              readFileSync(
                root
                + '/packages/dev-container-sdk/lib/'
                + new URL(req.url!, 'http://localhost').pathname.slice(5),
              ),
            ),
          );
          return;
        }
        res.setHeader('content-type', 'text/html');
        res.end(
          (
            '<html><head></head><body><script type="module">import '
            + '{account,isAvailable} from '
            + (
              '"/sdk/index.js";window.importAvailable=isAvailable();'
              + 'try{window.userBeforeLogin=await account.getUser();window.'
              + 'user=await account.login();window.account=account;window.'
              + 'sdkReady=true;}catch(e){window.sdkError=String(e);}</script>'
              + '</body></html>'
            )
          ),
        );
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      t.after(() => server.close());
      const game = join('C:/Temp', 'dc-' + mode + '-' + Date.now());
      mkdirSync(game, {
        recursive: true,
      });
      const config = game + '/dev-container.config.yaml';
      writeEditorSession(game, (server.address() as AddressInfo).port);
      prepareLaunchFiles(game, mode);
      writeFileSync(config, configText(mode));
      let app = await start(game, t);
      let client = await app.client();
      const userId = client.descriptor.user.id;
      const originHost = new URL(client.descriptor.url).hostname;
      const expectedPartition
        = mode === 'webview' ? 'persist:client-' + originHost : 'persist:dev-container';
      assert.equal(client.descriptor.partition, expectedPartition);
      assert.equal(
        client.descriptor.sessionPath,
        join(
          game,
          '.dev-container/electron/session-data/Partitions',
          expectedPartition.slice('persist:'.length),
        ),
      );
      assert.ok(existsSync(join(game, '.dev-container/electron/session-data/DevToolsActivePort')));
      assert.equal(existsSync(join(game, '.dev-container/electron/session-data/default')), false);
      assert.ok(existsSync(client.descriptor.sessionPath));
      assert.equal(await client.evaluate(() => window.importAvailable), true);
      assert.equal(
        await client.evaluate(() => window.account === window.__devContainer.account),
        true,
      );
      assert.deepEqual(
        await client.evaluate(() => Object.keys(window.__devContainer)),
        ['account'],
      );
      // The first game operation needs no explicit SDK initialization.
      assert.equal(await client.evaluate(() => window.userBeforeLogin), undefined);
      assert.deepEqual(await client.evaluate(async () => await window.account.getUser()), {
        id: userId,
      });
      const initialUrl = new URL(client.descriptor.url);
      assert.equal(initialUrl.searchParams.get('--enabled'), 'false');
      assert.equal(initialUrl.searchParams.get('count'), '0');
      assert.equal(initialUrl.searchParams.has('custom'), false);
      await client.evaluate(async () => {
        await window.account.logout();
      });
      assert.equal(await client.evaluate(async () => await window.account.getUser()), undefined);
      assert.deepEqual(await client.evaluate(async () => await window.account.login()), {
        id: userId,
      });
      assert.deepEqual(
        await client.evaluate(
          async () => await Promise.all([window.account.login(), window.account.login()]),
        ),
        [{ id: userId }, { id: userId }],
      );
      assert.equal(
        await client.evaluate(async () => {
          const login = window.account.login();
          const logout = window.account.logout();
          await Promise.all([login, logout]);
          return await window.account.getUser();
        }),
        undefined,
      );
      await client.evaluate(async () => await window.account.login());
      /// @case A game updates its route without changing origin.
      /// @expect The module API remains usable with the same registered identity, without
      /// reconnection.
      assert.deepEqual(
        await client.evaluate(async () => {
          history.replaceState(
            undefined,
            '',
            location.pathname + location.search + '&route=changed',
          );
          return await window.account.getUser();
        }),
        { id: userId },
      );
      await app.page
        .locator('.desktop-menus')
        .getByRole('button', { name: '客户端', exact: true })
        .click();
      await app.page
        .getByText('添加客户端', {
          exact: true,
        })
        .click();
      await app.page
        .getByRole('dialog')
        .getByLabel('绑定用户', { exact: true })
        .selectOption({ label: 'Client 1' });
      await app.page.getByRole('dialog').getByRole('button', { name: '添加', exact: true }).click();
      await app.page.getByRole('dialog').waitFor({ state: 'hidden' });
      await app.page.keyboard.press('Escape');
      const other = await app.client(1);
      assert.equal(other.descriptor.user.id, userId);
      assert.equal(other.descriptor.partition, client.descriptor.partition);
      assert.equal(other.descriptor.sessionPath, client.descriptor.sessionPath);
      assert.deepEqual(await other.evaluate(async () => await window.account.getUser()), {
        id: userId,
      });
      const replacement = createServer(server.listeners('request')[0]);
      replacement.listen(0, '127.0.0.1');
      await once(replacement, 'listening');
      t.after(() => replacement.close());
      writeEditorSession(game, (replacement.address() as AddressInfo).port);
      assert.equal(
        new URL((await app.descriptors())[0].previewUrl).port,
        String((server.address() as AddressInfo).port),
      );
      await app.page
        .locator('.client-panel')
        .first()
        .getByRole('button', { name: '刷新', exact: true })
        .click();
      await until(
        async () => (await app.descriptors())[0]?.token !== client.descriptor.token,
        'client refreshed with new editor port',
      );
      client = await app.client();
      assert.equal(new URL(client.descriptor.url).hostname, originHost);
      assert.equal(
        new URL(client.descriptor.previewUrl).port,
        String((replacement.address() as AddressInfo).port),
      );
      assert.equal(
        new URL((await app.descriptors())[1].previewUrl).port,
        String((server.address() as AddressInfo).port),
      );
      {
        assert.equal(
          await client.evaluate(() =>
            fetch('https://dev-container-client/socket.io/probe').then((response) =>
              response.text(),
            ),
          ),
          String((replacement.address() as AddressInfo).port),
        );
        assert.equal(
          await other.evaluate(() =>
            fetch('https://dev-container-client/socket.io/probe').then((response) =>
              response.text(),
            ),
          ),
          String((server.address() as AddressInfo).port),
        );
      }
      const selectedClientId = client.descriptor.clientId;
      const firstPanel = app.page.locator(
        '.client-panel[data-client-id="' + selectedClientId + '"]',
      );
      await firstPanel
        .getByRole('button', {
          name: '打开启动配置',
          exact: true,
        })
        .click();
      await app.page
        .getByLabel('设置 custom', {
          exact: true,
        })
        .check();
      await app.page
        .getByLabel('custom', {
          exact: true,
        })
        .fill('hello');
      await app.page
        .getByLabel('custom', {
          exact: true,
        })
        .dispatchEvent('change');
      await app.page
        .getByLabel('choice', {
          exact: true,
        })
        .selectOption('1');
      await app.page
        .getByRole('button', {
          name: '保存并重启',
          exact: true,
        })
        .click();
      try {
        await until(
          async () =>
            new URL((await app.descriptors())[0].url).searchParams.get('custom') === 'hello',
          'direct optional parameter',
        );
      } catch (error) {
        console.error(await app.page.getByRole('alert').allTextContents(), app.logs());
        throw error;
      }
      client = await app.client();
      // Invalid values must preserve the current client, and clearing optional values must omit
      // their URL parameter.
      await firstPanel
        .getByRole('button', {
          name: '打开启动配置',
          exact: true,
        })
        .click();
      const previousToken = client.descriptor.token;
      await app.page
        .getByLabel('count', {
          exact: true,
        })
        .fill('11');
      await app.page
        .getByLabel('count', {
          exact: true,
        })
        .dispatchEvent('change');
      await app.page
        .getByRole('button', {
          name: '保存并重启',
          exact: true,
        })
        .click();
      await app.page
        .getByRole('dialog')
        .getByRole('alert')
        .filter({
          hasText: 'Invalid launch parameters',
        })
        .waitFor();
      assert.equal((await app.descriptors())[0].token, previousToken);
      await app.page
        .getByLabel('count', {
          exact: true,
        })
        .fill('0');
      await app.page
        .getByLabel('count', {
          exact: true,
        })
        .dispatchEvent('change');
      await app.page
        .getByLabel('设置 custom', {
          exact: true,
        })
        .uncheck();
      await app.page
        .getByRole('button', {
          name: '保存并重启',
          exact: true,
        })
        .click();
      await until(
        async () => !new URL((await app.descriptors())[0].url).searchParams.has('custom'),
        'optional parameter removed',
      );
      client = await app.client();
      await app.page
        .locator('.desktop-menus')
        .getByRole('button', { name: '客户端', exact: true })
        .click();
      await app.page
        .getByText('添加客户端', {
          exact: true,
        })
        .click();
      await app.page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
      await app.page.getByRole('dialog').waitFor({ state: 'hidden' });
      await app.page
        .locator('.icon-rail')
        .getByRole('button', { name: '用户管理', exact: true })
        .click();
      await app.page.getByRole('button', { name: '新建用户', exact: true }).click();
      await app.page.getByLabel('用户名称', { exact: true }).fill('Second user');
      await app.page.getByRole('button', { name: '创建', exact: true }).click();
      await app.page.getByRole('dialog').waitFor({ state: 'hidden' });
      await app.page
        .locator('.desktop-menus')
        .getByRole('button', { name: '客户端', exact: true })
        .click();
      await app.page.getByText('添加客户端', { exact: true }).click();
      await app.page
        .getByRole('dialog')
        .getByLabel('绑定用户', { exact: true })
        .selectOption({ label: 'Second user' });
      await app.page.getByRole('dialog').getByRole('button', { name: '添加', exact: true }).click();
      await app.page.getByRole('dialog').waitFor({ state: 'hidden' });
      await app.page.keyboard.press('Escape');
      const secondDescriptor = (await app.descriptors()).find(
        (client) => client.user.name === 'Second user',
      )!;
      const second = await app.client(secondDescriptor.clientId);
      assert.notEqual(second.descriptor.user.id, userId);
      if (mode === 'webview') {
        assert.notEqual(second.descriptor.partition, client.descriptor.partition);
        assert.notEqual(second.descriptor.sessionPath, client.descriptor.sessionPath);
      } else {
        assert.equal(second.descriptor.partition, client.descriptor.partition);
      }
      await firstPanel
        .getByRole('button', {
          name: '切换用户',
          exact: true,
        })
        .click();
      await app.page
        .locator('.client-profile-picker__profile')
        .filter({
          hasText: 'Second user',
        })
        .click();
      await until(
        async () =>
          (await app.descriptors()).find((client) => client.clientId === selectedClientId)?.user
            .id === second.descriptor.user.id,
        'switch to second user',
      );
      client = await app.client(selectedClientId);
      assert.deepEqual(await client.evaluate(async () => await window.account.getUser()), {
        id: second.descriptor.user.id,
      });
      await firstPanel
        .getByRole('button', {
          name: '切换用户',
          exact: true,
        })
        .click();
      await app.page
        .locator('.client-profile-picker__profile')
        .filter({
          hasText: 'Client 1',
        })
        .click();
      try {
        await until(
          async () =>
            (await app.descriptors()).find((client) => client.clientId === selectedClientId)?.user
              .id === userId,
          'switch back to original user',
        );
      } catch (error) {
        console.error(await app.page.getByRole('alert').allTextContents(), app.logs());
        throw error;
      }
      client = await app.client(selectedClientId);
      assert.deepEqual(await client.evaluate(async () => await window.account.getUser()), {
        id: userId,
      });
      await app.close();
      app = await start(game, t);
      client = await app.client(selectedClientId);
      assert.equal(client.descriptor.user.id, userId);
      assert.equal(new URL(client.descriptor.url).hostname, originHost);
      assert.equal(new URL(client.descriptor.url).searchParams.has('custom'), false);
      assert.deepEqual(await client.evaluate(async () => await window.account.getUser()), {
        id: userId,
      });
      console.log(mode + ' acceptance passed');
    },
  );
}
await test(
  'invalid configuration reports path and schema error',
  {
    timeout: 60000,
  },
  async (t) => {
    /// @case A target folder contains a schema with an invalid default or unsupported nested
    /// keyword.
    /// @expect The app displays its configuration path and concrete validation error without a
    /// preview fallback.
    const game = join(root, '.test-runs', 'invalid-' + Date.now());
    mkdirSync(game, {
      recursive: true,
    });
    prepareLaunchFiles(game, 'iframe');
    writeFileSync(
      game + '/launch-params.schema.json',
      JSON.stringify(launchSchema).replace('"default":0', '"default":-1'),
    );
    writeFileSync(game + '/dev-container.config.yaml', configText('iframe'));
    const app = await start(game, t);
    const text = await app.page.locator('body').innerText();
    assert.match(text, /dev-container.config.yaml/);
    assert.match(text, /Invalid default|minimum/);
  },
);
if (process.env.DEV_CONTAINER_TEST_PACKAGED === '1') {
  await test(
    'Windows packaged app starts',
    {
      timeout: 120000,
    },
    async (t) => {
      /// @case The Windows directory package is started with an invalid target config.
      /// @expect The real executable loads its bundled UI and displays a useful configuration
      /// error.
      const game = join(root, '.test-runs', 'packaged-' + Date.now());
      mkdirSync(game, {
        recursive: true,
      });
      writeFileSync(game + '/dev-container.config.yaml', 'version: 2');
      const app = await start(game, t, true);
      assert.match(await app.page.locator('body').innerText(), /dev-container.config.yaml/);
    },
  );
}

await test(
  'Vortex preview defaults and paths use the target config directory',
  { timeout: 4 * 60000 },
  async (t) => {
    /// @case Target games omit client/dir or provide relative/absolute client directories and
    /// preview subpaths.
    /// @expect The host reads only each configured project session, preserves YAML, and loads
    /// native or custom preview paths.
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<html><body>Native preview</body></html>');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.close());
    const cases = [
      undefined,
      {},
      { dir: 'nested/client', subpath: 'super-preview' },
      { dir: 'ABSOLUTE', subpath: '/custom/preview' },
    ];
    for (const [index, client] of cases.entries()) {
      const game = join(root, '.test-runs', 'vortex-path-' + Date.now() + '-' + index);
      mkdirSync(game, { recursive: true });
      if (client?.dir === 'ABSOLUTE') {
        client.dir = join(game, 'absolute-client');
      }
      writeEditorSession(game, (server.address() as AddressInfo).port, client?.dir ?? '.');
      const config = JSON.stringify({
        version: 1,
        game: { id: 'path-test', title: 'Path test' },
        ...(client ? { client } : {}),
      });
      writeFileSync(join(game, 'dev-container.config.yaml'), config);
      const app = await start(game, t);
      await app.page
        .locator('.desktop-menus')
        .getByRole('button', { name: '客户端', exact: true })
        .waitFor({ timeout: 5000 });
      const descriptor = await until(
        async () => (await app.descriptors())[0],
        'native preview descriptor',
      );
      assert.equal(
        new URL(descriptor.url).pathname,
        '/' + (client?.subpath ?? '').replace(/^\/+/, ''),
      );
      assert.equal(
        new URL(descriptor.previewUrl).port,
        String((server.address() as AddressInfo).port),
      );
      assert.equal(descriptor.viewHost, 'webview');
      assert.equal(readFileSync(join(game, 'dev-container.config.yaml'), 'utf8'), config);
      await app.stop();
    }
  },
);

await test(
  'Vortex session errors preserve the host and recover on retry',
  { timeout: 90000 },
  async (t) => {
    /// @case A target project has a missing, damaged, unsupported, invalid-port, dead-editor or
    /// unreachable session.
    /// @expect The client shows the exact session path and reason, never uses a different session,
    /// and retries successfully after correction.
    const parent = join(root, '.test-runs', 'vortex-errors-' + Date.now()),
      game = join(parent, 'game');
    mkdirSync(game, { recursive: true });
    writeEditorSession(parent, 7456, '.');
    writeFileSync(
      join(game, 'dev-container.config.yaml'),
      JSON.stringify({ version: 1, game: { id: 'errors', title: 'Errors' } }),
    );
    const app = await start(game, t);
    const panel = app.page.locator('.client-panel').first();
    const alert = panel.locator('.diagnostic-card [role=alert]');
    await alert.waitFor();
    assert.match(await alert.innerText(), /editor-session.json/);
    assert.ok((await alert.innerText()).includes(join(game, 'temp', 'editor-session.json')));
    assert.equal(await app.page.getByRole('button', { name: '用户管理', exact: true }).count(), 1);
    const file = join(game, 'temp', 'editor-session.json');
    mkdirSync(join(game, 'temp'));
    const deadEditor = spawn(process.execPath, ['-e', ''], { windowsHide: true });
    await once(deadEditor, 'exit');
    const offline = createServer();
    offline.listen(0, '127.0.0.1');
    await once(offline, 'listening');
    const offlinePort = (offline.address() as AddressInfo).port;
    await new Promise((accept) => offline.close(accept));
    const broken: Array<[string, RegExp]> = [
      ['{', /JSON|Unexpected|property name/],
      [
        JSON.stringify({
          'schemaVersion': 2,
          'server.port': 7456,
          'editor.pid': process.pid,
        }),
        /schemaVersion/,
      ],
      [
        JSON.stringify({
          'schemaVersion': 1,
          'server.port': 0,
          'editor.pid': process.pid,
        }),
        /server.port/,
      ],
      [
        JSON.stringify({
          'schemaVersion': 1,
          'server.port': 7456,
          'editor.pid': deadEditor.pid,
        }),
        /Editor process .* is no longer running.*Start Vortex .*retry/u,
      ],
      [
        JSON.stringify({
          'schemaVersion': 1,
          'server.port': offlinePort,
          'editor.pid': process.pid,
        }),
        /fetch|connect|ECONNREFUSED|preview/i,
      ],
    ];
    for (const [session, reason] of broken) {
      writeFileSync(file, session);
      await panel.getByRole('button', { name: '重试', exact: true }).click();
      await until(async () => {
        const text = await alert.innerText().catch(() => '');
        return reason.test(text) && text.includes(file);
      }, 'session diagnostic');
    }
    const server = createServer((_req, res) => {
      res.end('<html>Recovered</html>');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.close());
    writeEditorSession(game, (server.address() as AddressInfo).port, '.');
    await panel.getByRole('button', { name: '重试', exact: true }).click();
    const descriptor = await until(async () => (await app.descriptors())[0], 'recovered preview');
    assert.equal(
      new URL(descriptor.previewUrl).port,
      String((server.address() as AddressInfo).port),
    );
    await until(async () => (await alert.count()) === 0, 'cleared preview diagnostic');
  },
);

await test(
  'Vortex config rejects old URLs and non-path subpaths',
  { timeout: 6 * 60000 },
  async (t) => {
    /// @case YAML specifies removed URL/source fields or a URL, query or fragment as its subpath.
    /// @expect The app rejects the configuration with its path and validation reason.
    for (const client of [
      { url: 'http://localhost:7456/' },
      { preview: { type: 'vortex' } },
      ...[
        'http://localhost/',
        '//localhost/',
        'preview?scene=x',
        'preview#x',
      ].map((subpath) => ({
        subpath,
      })),
    ]) {
      const game = join(root, '.test-runs', 'vortex-invalid-' + Date.now());
      mkdirSync(game, { recursive: true });
      writeFileSync(
        join(game, 'dev-container.config.yaml'),
        JSON.stringify({
          version: 1,
          game: { id: 'invalid', title: 'Invalid' },
          client,
        }),
      );
      const app = await start(game, t);
      const text = await app.page.locator('body').innerText();
      assert.match(text, /dev-container.config.yaml/);
      assert.match(text, /additional properties|pattern|subpath/);
      await app.stop();
    }
  },
);

await test(
  'external schema diagnostics and old parameter recovery',
  { timeout: 4 * 60000 },
  async (t) => {
    /// @case A JSON schema is missing or damaged; later its URL field names change while client
    /// state exists.
    /// @expect Errors identify both files, and restoring defaults repairs only launch values
    /// without changing the bound user.
    const game = join(root, '.test-runs', 'external-' + Date.now());
    mkdirSync(game, { recursive: true });
    writeFileSync(join(game, 'dev-container.config.yaml'), configText('webview'));
    let app = await start(game, t);
    assert.match(await app.page.locator('body').innerText(), /launch-params.schema.json/);
    assert.match(await app.page.locator('body').innerText(), /dev-container.config.yaml/);
    await app.stop();
    writeFileSync(join(game, 'launch-params.schema.json'), '{');
    app = await start(game, t);
    assert.match(await app.page.locator('body').innerText(), /launch-params.schema.json/);
    await app.stop();
    const server = createServer((_req, res) => res.end('<html>Schema preview</html>'));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.close());
    prepareLaunchFiles(game, 'webview');
    writeEditorSession(game, (server.address() as AddressInfo).port);
    app = await start(game, t);
    const initial = await until(async () => (await app.descriptors())[0], 'original launch values');
    await app.page.getByRole('button', { name: '打开启动配置', exact: true }).click();
    await app.page.getByLabel('count', { exact: true }).fill('1');
    await app.page.getByLabel('count', { exact: true }).dispatchEvent('change');
    await app.page.getByRole('button', { name: '保存并重启', exact: true }).click();
    await until(() => {
      try {
        const layout = JSON.parse(
          readFileSync(join(game, '.dev-container/window-layout.json'), 'utf8'),
        ) as WindowLayout;
        return Object.values(layout.layoutState.dockView.panels).some(
          (panel) => panel.params.values.count === 1,
        );
      } catch {
        return false;
      }
    }, 'persisted original launch values');
    await app.stop();
    const nextSchema = {
      ...launchSchema,
      properties: { renamed: { type: 'integer', default: 7 } },
      required: ['renamed'],
    };
    writeFileSync(join(game, 'launch-params.schema.json'), JSON.stringify(nextSchema));
    app = await start(game, t);
    await app.page
      .locator('.diagnostic-card [role=alert]')
      .filter({ hasText: 'Invalid launch parameters' })
      .waitFor();
    const panel = app.page.locator('.client-panel').first();
    await panel.getByRole('button', { name: '打开启动配置', exact: true }).click();
    await app.page.getByRole('button', { name: '恢复默认', exact: true }).click();
    await app.page.getByRole('button', { name: '保存并重启', exact: true }).click();
    const repaired = await until(
      async () => (await app.descriptors())[0],
      'repaired launch values',
    );
    assert.equal(repaired.user.id, initial.user.id);
    assert.equal(new URL(repaired.url).searchParams.get('renamed'), '7');
    assert.equal(new URL(repaired.url).searchParams.has('count'), false);
  },
);

await test(
  'preference is local and take effect on next startup',
  { timeout: 3 * 60000 },
  async (t) => {
    /// @case A user edits preference in the content area, discards a draft, saves and reopens
    /// through the D/C menu.
    /// @expect No modal opens; navigation preserves the current client, discarding changes does not
    /// save, and persisted local preference apply on next startup.
    const server = createServer((_req, res) => res.end('<html>Preference preview</html>'));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.close());
    const game = join(root, '.test-runs', 'preference-' + Date.now());
    mkdirSync(game, { recursive: true });
    const config = JSON.stringify({ version: 1, game: { id: 'preference', title: 'Preference' } });
    writeFileSync(join(game, 'dev-container.config.yaml'), config);
    writeEditorSession(game, (server.address() as AddressInfo).port, '.');
    let app = await start(game, t);
    const initial = await until(async () => (await app.descriptors())[0], 'default webview');
    assert.equal(
      await app.page
        .locator('.desktop-menus')
        .getByRole('button', { name: '设置', exact: true })
        .count(),
      0,
    );
    assert.equal(
      await app.page
        .locator('.icon-rail')
        .getByRole('button', { name: '偏好设置', exact: true })
        .count(),
      0,
    );
    await app.page.getByRole('button', { name: 'Dev Container 菜单', exact: true }).click();
    await app.page
      .locator('.desktop-dropdown')
      .getByRole('button', { name: '偏好设置', exact: true })
      .click();
    const preference = app.page.getByRole('region', { name: '偏好设置', exact: true });
    await preference.waitFor({ timeout: 5000 });
    assert.equal(await app.page.getByRole('dialog').count(), 0);
    await preference.getByLabel('预览模式', { exact: true }).selectOption('iframe');
    await preference.getByLabel('启动布局', { exact: true }).selectOption('empty');
    await preference.getByLabel('保存布局', { exact: true }).uncheck();
    await preference.getByRole('button', { name: '放弃修改', exact: true }).click();
    assert.equal(await preference.getByLabel('预览模式', { exact: true }).inputValue(), 'webview');
    assert.equal(await preference.getByLabel('启动布局', { exact: true }).inputValue(), 'saved');
    assert.equal(await preference.getByLabel('保存布局', { exact: true }).isChecked(), true);
    await preference.getByLabel('预览模式', { exact: true }).selectOption('iframe');
    await preference.getByLabel('启动布局', { exact: true }).selectOption('default');
    await preference.getByLabel('保存布局', { exact: true }).uncheck();
    await preference.getByRole('button', { name: '保存', exact: true }).click();
    await preference.getByRole('status').waitFor();
    assert.match(await preference.getByRole('status').innerText(), /已保存.*下次启动生效/u);
    await app.page
      .locator('.icon-rail')
      .getByRole('button', { name: '客户端', exact: true })
      .click();
    await app.page.locator('.client-panel').waitFor();
    await app.page.getByRole('button', { name: 'Dev Container 菜单', exact: true }).click();
    await app.page
      .locator('.desktop-dropdown')
      .getByRole('button', { name: '偏好设置', exact: true })
      .click();
    await preference.waitFor();
    assert.equal(await app.page.getByRole('dialog').count(), 0);
    assert.equal(await preference.getByLabel('预览模式', { exact: true }).inputValue(), 'iframe');
    assert.equal((await app.descriptors())[0].token, initial.token);
    assert.equal(readFileSync(join(game, 'dev-container.config.yaml'), 'utf8'), config);
    assert.equal(
      JSON.parse(readFileSync(join(game, '.dev-container/preference.json'), 'utf8')).viewHost,
      'iframe',
    );
    await app.stop();
    app = await start(game, t);
    const next = await until(async () => (await app.descriptors())[0], 'saved iframe');
    assert.equal(next.viewHost, 'iframe');
    assert.equal(next.user.id, initial.user.id);
    const debug = JSON.parse(
      readFileSync(join(game, '.dev-container/debug-session.json'), 'utf8'),
    ) as DebugSession;
    assert.equal(debug.pid, app.child.pid);
    assert.ok(debug.remoteDebuggingPort !== null && debug.remoteDebuggingPort > 0);
  },
);

await test(
  'external schema accepts relative and absolute paths and rejects removed config fields',
  { timeout: 12 * 60000 },
  async (t) => {
    /// @case A target uses an external JSON file outside the config root or supplies obsolete
    /// config/schema keywords.
    /// @expect Paths are based on the YAML directory; unsupported inline schemas, mappings, host
    /// preferences and nested fields show concrete diagnostics.
    const server = createServer((_request, response) =>
      response.end('<html>External schema</html>'),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.close());
    const game = join(root, '.test-runs', 'schema-paths-' + Date.now());
    mkdirSync(join(game, 'client'), { recursive: true });
    const schemaFile = join(game, 'client/launch-params.schema.json');
    const base = {
      version: 1,
      game: { id: 'schema-path', title: 'Schema path' },
      client: { dir: 'client' },
      launch: { schema: 'client/launch-params.schema.json' },
    };
    writeFileSync(schemaFile, JSON.stringify(launchSchema));
    writeEditorSession(game, (server.address() as AddressInfo).port);
    for (const schema of ['client/launch-params.schema.json', schemaFile]) {
      writeFileSync(
        join(game, 'dev-container.config.yaml'),
        JSON.stringify({ ...base, launch: { schema } }),
      );
      const app = await start(game, t);
      const descriptor = await until(
        async () => (await app.descriptors())[0],
        'external schema path',
      );
      assert.equal(new URL(descriptor.url).searchParams.get('--enabled'), 'false');
      assert.equal(new URL(descriptor.url).searchParams.get('count'), '0');
      await app.stop();
    }
    const invalid: Array<[unknown, RegExp]> = [
      [{ ...base, launch: { schema: launchSchema } }, /must be string/],
      [
        { ...base, launch: { ...base.launch, queryParameters: { count: 'count' } } },
        /additional properties/,
      ],
      [{ ...base, window: { maximized: true } }, /additional properties/],
      [{ ...base, debug: { remoteDebuggingPort: 9333 } }, /additional properties/],
      [{ ...base, client: { ...base.client, viewHost: 'iframe' } }, /additional properties/],
      [{ ...base, client: { ...base.client, muted: false } }, /additional properties/],
    ];
    for (const [config, reason] of invalid) {
      writeFileSync(join(game, 'dev-container.config.yaml'), JSON.stringify(config));
      const app = await start(game, t);
      const text = await app.page.locator('body').innerText();
      assert.match(text, /dev-container.config.yaml/);
      assert.match(text, reason);
      await app.stop();
    }
    const schemas: Array<[unknown, RegExp]> = [
      [{ ...launchSchema, $schema: 'https://json-schema.org/draft/2020-12/schema' }, /draft-07/],
      [
        {
          ...launchSchema,
          properties: { nested: { type: 'object', properties: {} } },
          required: [],
        },
        /Unsupported launch field/,
      ],
      [
        {
          ...launchSchema,
          properties: { list: { type: 'array', items: { type: 'string' } } },
          required: [],
        },
        /Unsupported launch field/,
      ],
      [{ ...launchSchema, required: ['unknown'] }, /Required launch field/],
    ];
    writeFileSync(join(game, 'dev-container.config.yaml'), JSON.stringify(base));
    for (const [schema, reason] of schemas) {
      writeFileSync(schemaFile, JSON.stringify(schema));
      const app = await start(game, t);
      const text = await app.page.locator('body').innerText();
      assert.ok(text.includes(schemaFile));
      assert.match(text, reason);
      await app.stop();
    }
  },
);

await test(
  'account management panel renders users and supports creation and rename',
  { timeout: 60000 },
  async (t) => {
    /// @case Client creation opens its own dialog; the sidebar opens account management for
    /// creation and rename.
    /// @expect Readable text contrasts with the workbench surface; users display and both
    /// management operations persist.
    const game = join(root, '.test-runs', 'account-panel-' + Date.now());
    mkdirSync(game, { recursive: true });
    writeFileSync(
      join(game, 'dev-container.config.yaml'),
      JSON.stringify({ version: 1, game: { id: 'account-panel', title: 'Account panel' } }),
    );
    const server = createServer((_request, response) =>
      response.end('<html><body style="background:white">Preview content</body></html>'),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.close());
    writeEditorSession(game, (server.address() as AddressInfo).port, '.');
    const app = await start(game, t);
    await until(async () => (await app.descriptors())[0], 'live preview');
    await app.page
      .locator('.desktop-menus')
      .getByRole('button', { name: '客户端', exact: true })
      .click();
    await app.page.getByText('添加客户端', { exact: true }).click();
    await app.page.getByRole('dialog').getByLabel('绑定用户', { exact: true }).waitFor();
    assert.equal(await app.page.getByRole('button', { name: '用户管理', exact: true }).count(), 1);
    await app.page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    await app.page.getByRole('dialog').waitFor({ state: 'hidden' });
    await app.page.keyboard.press('Escape');
    await app.page.getByRole('button', { name: '用户管理', exact: true }).click();
    try {
      await app.page.locator('.users-table tbody tr').first().waitFor({ timeout: 5000 });
    } catch (error) {
      console.log(await app.page.locator('body').innerText(), app.logs());
      await app.page.screenshot({ path: join(game, 'account-panel.png') });
      throw error;
    }
    const panel = app.page.locator('.account-panel');
    const contrast = await panel.evaluate((element) => {
      const foreground = getComputedStyle(element).color;
      const background = getComputedStyle(element.closest('.v-application')!).backgroundColor;

      function luminance(color: string) {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map((value) => {
            const channel = Number(value) / (color.startsWith('color(srgb') ? 1 : 255);
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      }

      const front = luminance(foreground),
        back = luminance(background);
      return (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
    });
    assert.ok(
      contrast >= 4.5,
      'User management text must contrast with the workbench surface; got ' + contrast,
    );
    await panel.getByRole('button', { name: '新建用户', exact: true }).click();
    assert.equal(await app.page.getByRole('dialog').locator('input[type=file]').count(), 0);
    await app.page.getByLabel('用户名称', { exact: true }).fill('Panel user');
    await app.page.getByRole('button', { name: '创建', exact: true }).click();
    await app.page.getByRole('dialog').waitFor({ state: 'hidden' });
    await until(
      async () => (await panel.locator('.users-table tbody tr').count()) === 2,
      'created account',
    );
    await panel.getByRole('button', { name: '编辑 Panel user', exact: true }).click();
    assert.equal(await app.page.getByRole('dialog').locator('input[type=file]').count(), 0);
    await app.page.getByLabel('用户名称', { exact: true }).fill('Renamed user');
    await app.page.getByRole('button', { name: '保存', exact: true }).click();
    await app.page.getByRole('dialog').waitFor({ state: 'hidden' });
    await until(
      () =>
        (
          JSON.parse(readFileSync(join(game, '.dev-container/users.json'), 'utf8')) as UserFile
        ).users.some((user) => user.name === 'Renamed user'),
      'renamed account',
    );
    assert.equal(await panel.getByRole('alert').count(), 0);
  },
);

await test(
  'workbench client controls preserve viewport and empty layout',
  { timeout: 120000 },
  async (t) => {
    /// @case A client uses a fixed viewport, closes through its separated header button, and the
    /// host restarts with the saved empty layout.
    /// @expect Dimensions persist without reloading the game; no closed client returns, and
    /// restoring defaults creates a usable client.
    const game = join(root, '.test-runs', 'workbench-' + Date.now());
    mkdirSync(game, { recursive: true });
    writeFileSync(
      join(game, 'dev-container.config.yaml'),
      JSON.stringify({ version: 1, game: { id: 'workbench', title: 'Workbench' } }),
    );
    const server = createServer((_request, response) =>
      response.end('<html>Viewport fixture</html>'),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.close());
    writeEditorSession(game, (server.address() as AddressInfo).port, '.');
    let app = await start(game, t);
    await until(async () => (await app.descriptors()).length === 1, 'client registered');
    const token = (await app.descriptors())[0].token;
    await app.page.getByRole('button', { name: '视口适配', exact: true }).click();
    await app.page.getByLabel('视口宽度', { exact: true }).fill('640');
    await app.page.getByLabel('视口高度', { exact: true }).fill('360');
    await app.page.getByRole('button', { name: '应用', exact: true }).click();
    const bounds = await app.page.locator('.client-view-panel__frame').boundingBox();
    assert.ok(bounds);
    assert.equal(bounds.width, 640);
    assert.equal(bounds.height, 360);
    assert.equal((await app.descriptors())[0].token, token);
    await app.page.getByRole('button', { name: '关闭客户端', exact: true }).click();
    await app.page.locator('.client-panel').waitFor({ state: 'detached' });
    await until(
      () =>
        Object.keys(
          (
            JSON.parse(
              readFileSync(join(game, '.dev-container/window-layout.json'), 'utf8'),
            ) as WindowLayout
          ).layoutState.dockView.panels,
        ).length === 0,
      'empty layout saved',
    );
    await app.stop();
    app = await start(game, t);
    await app.page.getByText('从客户端菜单添加客户端', { exact: true }).waitFor();
    assert.equal(await app.page.locator('.client-panel').count(), 0);
    await app.page
      .locator('.desktop-menus')
      .getByRole('button', { name: '视图', exact: true })
      .click();
    await app.page.getByRole('button', { name: '恢复默认布局', exact: true }).click();
    await app.page.locator('.client-panel').waitFor();
    await until(async () => (await app.descriptors()).length === 1, 'default client registered');
  },
);

for (const mode of ['webview', 'iframe']) {
  await test(
    mode + ' client creation dialog validates drafts and persists the selected user',
    { timeout: 60000 },
    async (t) => {
      /// @case Open client creation with launch fields collapsed, create a user inline, edit launch
      /// fields, reject an invalid draft, cancel and create a valid client.
      /// @expect User creation selects the new persisted user without creating a client; launch
      /// fields collapse on each opening, and a confirmed client preserves its user, name and
      /// parameters across restart.
      const game = join(root, '.test-runs', 'create-client-' + mode + '-' + Date.now());
      mkdirSync(game, { recursive: true });
      prepareLaunchFiles(game, mode);
      writeFileSync(join(game, 'dev-container.config.yaml'), configText(mode));
      const server = createServer((_request, response) =>
        response.end('<html>Client creation fixture</html>'),
      );
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      t.after(() => server.close());
      writeEditorSession(game, (server.address() as AddressInfo).port);
      let app = await start(game, t);
      await until(async () => (await app.descriptors()).length === 1, 'initial client');

      async function openCreation() {
        await app.page
          .locator('.desktop-menus')
          .getByRole('button', { name: '客户端', exact: true })
          .click();
        await app.page.getByRole('button', { name: '添加客户端', exact: true }).click();
        const dialog = app.page.getByRole('dialog');
        await dialog.waitFor({ timeout: 5000 });
        return dialog;
      }

      let dialog = await openCreation();
      assert.equal(
        await dialog
          .getByRole('button', { name: '启动参数', exact: true })
          .getAttribute('aria-expanded'),
        'false',
      );
      assert.equal(await dialog.getByLabel('count', { exact: true }).isVisible(), false);
      await dialog.getByRole('button', { name: '新建用户', exact: true }).click();
      await dialog.getByLabel('用户名称', { exact: true }).fill('Cancelled user');
      await dialog.getByRole('button', { name: '取消新建用户', exact: true }).click();
      assert.equal(
        (JSON.parse(readFileSync(join(game, '.dev-container/users.json'), 'utf8')) as UserFile)
          .users.length,
        1,
      );
      await dialog.getByRole('button', { name: '新建用户', exact: true }).click();
      await dialog.getByLabel('用户名称', { exact: true }).fill('Second user');
      await dialog.getByRole('button', { name: '创建用户', exact: true }).click();
      const newUser = await until(
        () =>
          (
            JSON.parse(readFileSync(join(game, '.dev-container/users.json'), 'utf8')) as UserFile
          ).users.find((candidate) => candidate.name === 'Second user'),
        'inline user saved',
      );
      await until(
        async () =>
          (await dialog.getByLabel('绑定用户', { exact: true }).inputValue()) === newUser.id,
        'new user automatically selected',
      );
      assert.equal((await app.descriptors()).length, 1);
      await dialog.getByRole('button', { name: '启动参数', exact: true }).click();
      await dialog.getByLabel('绑定用户', { exact: true }).selectOption({ label: 'Second user' });
      await dialog.getByLabel('客户端名称', { exact: true }).fill('Draft client');
      await dialog.getByLabel('count', { exact: true }).fill('11');
      await dialog.getByLabel('count', { exact: true }).dispatchEvent('change');
      await dialog.getByRole('button', { name: '添加', exact: true }).click();
      await dialog.getByRole('alert').waitFor();
      assert.match(await dialog.getByRole('alert').innerText(), /maximum|<= 10/u);
      assert.equal((await app.descriptors()).length, 1);
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      dialog = await openCreation();
      assert.equal(
        await dialog
          .getByRole('button', { name: '启动参数', exact: true })
          .getAttribute('aria-expanded'),
        'false',
      );
      assert.equal(
        (JSON.parse(readFileSync(join(game, '.dev-container/users.json'), 'utf8')) as UserFile)
          .users.length,
        2,
      );
      await dialog.getByRole('button', { name: '启动参数', exact: true }).click();
      assert.equal(await dialog.getByLabel('count', { exact: true }).inputValue(), '0');
      assert.equal(await dialog.getByLabel('设置 custom', { exact: true }).isChecked(), false);
      assert.equal(await dialog.getByLabel('客户端名称', { exact: true }).inputValue(), 'Client 2');
      await dialog.getByLabel('绑定用户', { exact: true }).selectOption({ label: 'Second user' });
      const selectedId = await dialog.getByLabel('绑定用户', { exact: true }).inputValue();
      await dialog.getByLabel('客户端名称', { exact: true }).fill('Second view');
      await dialog.getByLabel('设置 custom', { exact: true }).check();
      await dialog.getByLabel('custom', { exact: true }).fill('chosen');
      await dialog.getByLabel('custom', { exact: true }).dispatchEvent('change');
      await dialog.getByRole('button', { name: '添加', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      let created = await until(
        async () => (await app.descriptors()).find((client) => client.user.id === selectedId),
        'created client',
      );
      assert.equal(created.viewHost, mode);
      const url = new URL(created.url);
      assert.equal(url.searchParams.get('count'), '0');
      assert.equal(url.searchParams.get('--enabled'), 'false');
      assert.equal(url.searchParams.get('custom'), 'chosen');
      await until(() => {
        const state = JSON.parse(
          readFileSync(join(game, '.dev-container/window-layout.json'), 'utf8'),
        ) as WindowLayout;
        return state.layoutState.dockView.panels[created.clientId]?.title === 'Second view';
      }, 'client name saved');
      await app.stop();
      app = await start(game, t);
      await until(async () => (await app.descriptors()).length === 2, 'both restored clients');
      created = (await app.descriptors()).find((client) => client.user.id === selectedId)!;
      assert.equal(new URL(created.url).searchParams.get('custom'), 'chosen');
      assert.equal((await app.descriptors()).length, 2);
    },
  );
}

function nativeWindowAction(processId: number, action = 'inspect', button = '') {
  const script = `. 'U:\\codex-prelude.ps1'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class NativeWindowControl {
 public delegate bool Callback(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb, IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Callback cb, IntPtr p);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text, int count);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder text, int count);
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
 public sealed class Window {
  public long Handle { get; set; } public string Title { get; set; } public string Class { get; set; }
  public bool Minimized { get; set; } public bool Maximized { get; set; }
  public List<string> Text { get; set; }
 }
 static string Text(IntPtr h, bool className = false) {
  var text = new StringBuilder(2048);
  if (className) GetClassName(h, text, text.Capacity); else GetWindowText(h, text, text.Capacity);
  return text.ToString();
 }
 public static Window[] Run(uint owner, string action, string button) {
  var windows = new List<Window>();
  EnumWindows((h, p) => {
   uint pid; GetWindowThreadProcessId(h, out pid);
   if (pid != owner || (!IsWindowVisible(h) && action != "close")) return true;
   var title = Text(h); var cls = Text(h, true);
   if (title.Length == 0) return true;
   var children = new List<string>();
   if (cls == "#32770") EnumChildWindows(h, (child, unused) => {
    var text = Text(child); children.Add(text);
    if (action == "button" && cls == "#32770" && text.Replace("&", "") == button)
     PostMessage(child, 0x00F5, IntPtr.Zero, IntPtr.Zero);
    return true;
   }, IntPtr.Zero);
   if (cls == "Chrome_WidgetWin_1" && action != "inspect" && action != "button") {
    uint command = action == "minimize" ? 0xF020u : action == "maximize" ? 0xF030u : action == "restore" ? 0xF120u : 0xF060u;
    PostMessage(h, 0x0112, (IntPtr)command, IntPtr.Zero);
   }
   windows.Add(new Window { Handle = h.ToInt64(), Title = title, Class = cls, Minimized = IsIconic(h), Maximized = IsZoomed(h), Text = children });
   return true;
  }, IntPtr.Zero);
  return windows.ToArray();
 }
}
'@
$taskWindows = @([NativeWindowControl]::Run(${processId}, '${action.replaceAll('\'', '\'\'')}', '${button.replaceAll('\'', '\'\'')}'))
if ('${action}' -eq 'inspect') {
  foreach ($taskWindow in $taskWindows) {
    if ($taskWindow.Class -eq '#32770') {
      Add-Type -AssemblyName UIAutomationClient
      $taskElement = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$taskWindow.Handle)
      $taskChildren = $taskElement.FindAll([System.Windows.Automation.TreeScope]::Subtree, [System.Windows.Automation.Condition]::TrueCondition)
      foreach ($taskChild in $taskChildren) { $taskWindow.Text.Add($taskChild.Current.Name) }
    }
  }
}
ConvertTo-Json -InputObject $taskWindows -Depth 4 -Compress`;
  const result = spawnSync('pwsh.exe', [
    '-NoProfile',
    '-Command',
    script,
  ], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return JSON.parse(result.stdout.trim()) as NativeWindow[];
}

for (const mode of ['webview', 'iframe']) {
  await test(
    mode + ' native close remains usable when a renderer hangs',
    { skip: process.platform !== 'win32', timeout: 90000 },
    async (t) => {
      /// @case The game (webview) or host renderer (iframe) hangs after login, and the user closes
      /// through the native window command.
      /// @expect Native close remains available independently of the hung renderer.
      const server = createServer((request, response) => {
        response.setHeader(
          'content-type',
          request.url!.startsWith('/sdk/') ? 'application/javascript' : 'text/html',
        );
        response.end(
          request.url!.startsWith('/sdk/')
            ? readFileSync(
              root
              + '/packages/dev-container-sdk/lib/'
              + new URL(request.url!, 'http://localhost').pathname.slice(5),
            )
            : (
              '<html><body><script type="module">import {account} from '
              + '"/sdk/index.js";await '
              + (
                'account.login();window.account=account;window.sdkReady=true;'
                + '</script></body></html>'
              )
            ),
        );
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      t.after(() => server.close());
      const game = join(root, '.test-runs', 'native-close-' + mode + '-' + Date.now());
      mkdirSync(game, { recursive: true });
      prepareLaunchFiles(game, mode);
      writeFileSync(join(game, 'dev-container.config.yaml'), configText(mode, 'native-close'));
      writeEditorSession(game, (server.address() as AddressInfo).port);
      const app = await start(game, t, false, true);
      const client = await app.client();
      const hang = () => {
        setTimeout(() => {
          while (true) {
            // Deliberately block the fixture renderer to exercise native recovery.
          }
        }, 100);
      };
      if (mode === 'webview') {
        await client.evaluate(hang);
      } else {
        await app.page.evaluate(hang);
      }
      await sleep(200);
      const exited = once(app.child, 'exit');
      nativeWindowAction(app.child.pid!, 'close');
      await Promise.race([
        exited,
        sleep(10000).then(() => {
          throw new Error('Hung renderer prevented native close.');
        }),
      ]);
    },
  );
}

await test(
  'native title bar supports window controls and safe-area menus',
  { skip: process.platform !== 'win32', timeout: 60000 },
  async (t) => {
    /// @case A real window exposes native controls beside the workbench menu, minimizes, maximizes,
    /// restores, and closes normally.
    /// @expect The overlay reserves space for its controls, menus remain clickable, native commands
    /// work, and normal close persists window state.
    const server = createServer((request, response) => {
      response.setHeader(
        'content-type',
        request.url!.startsWith('/sdk/') ? 'application/javascript' : 'text/html',
      );
      response.end(
        request.url!.startsWith('/sdk/')
          ? readFileSync(
            root
            + '/packages/dev-container-sdk/lib/'
            + new URL(request.url!, 'http://localhost').pathname.slice(5),
          )
          : (
            '<html><body><script type="module">import {account} from '
            + '"/sdk/index.js";await '
            + 'account.login();window.account=account;window.sdkReady=true;</script></body></html>'
          ),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.close());
    const game = join(root, '.test-runs', 'native-title-' + Date.now());
    mkdirSync(game, { recursive: true });
    prepareLaunchFiles(game, 'webview');
    writeFileSync(join(game, 'dev-container.config.yaml'), configText('webview', 'native-title'));
    writeEditorSession(game, (server.address() as AddressInfo).port);
    const app = await start(game, t, false, true);
    await app.client();
    const overlay = await app.page.evaluate(() => ({
      // eslint-disable-next-line n/no-unsupported-features/node-builtins -- Chromium navigator API.
      visible: window.navigator.windowControlsOverlay.visible,
      // eslint-disable-next-line n/no-unsupported-features/node-builtins -- Chromium navigator API.
      area: window.navigator.windowControlsOverlay.getTitlebarAreaRect().toJSON(),
      width: innerWidth,
      menu: document.querySelector('.desktop-menus')!.getBoundingClientRect().toJSON(),
      status: document.querySelector('.remote-debug')!.getBoundingClientRect().toJSON(),
      brandButton: document.querySelector('.menu-brand')!.getBoundingClientRect().toJSON(),
      brandMark: document.querySelector('.brand-mark')!.getBoundingClientRect().toJSON(),
    }));
    assert.equal(overlay.visible, true);
    assert.equal(overlay.area.height, 42);
    assert.ok(
      Math.abs(
        overlay.brandMark.y
        + overlay.brandMark.height / 2
        - overlay.brandButton.y
        - overlay.brandButton.height / 2,
      ) <= 1,
      'D/C icon must be vertically centered in its menu button',
    );
    assert.ok(
      Math.abs(
        overlay.brandMark.x
        + overlay.brandMark.width / 2
        - overlay.brandButton.x
        - overlay.brandButton.width / 2,
      ) <= 1,
      'D/C icon must be horizontally centered in its menu button',
    );
    assert.ok(overlay.area.width < overlay.width);
    assert.ok(overlay.status.right <= overlay.area.right + 1);
    assert.ok(overlay.menu.right < overlay.status.left);
    await app.page
      .locator('.desktop-menus')
      .getByRole('button', { name: '客户端', exact: true })
      .click();
    await app.page.getByText('添加客户端', { exact: true }).click();
    await app.page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    nativeWindowAction(app.child.pid!, 'minimize');
    await until(
      () => nativeWindowAction(app.child.pid!).some((window) => window.Minimized),
      'window minimized',
    );
    nativeWindowAction(app.child.pid!, 'restore');
    await until(
      () =>
        nativeWindowAction(app.child.pid!).some(
          (window) =>
            window.Class === 'Chrome_WidgetWin_1' && !window.Minimized && !window.Maximized,
        ),
      'normal window restored',
    );
    nativeWindowAction(app.child.pid!, 'maximize');
    await until(
      () => nativeWindowAction(app.child.pid!).some((window) => window.Maximized),
      'window maximized',
    );
    nativeWindowAction(app.child.pid!, 'restore');
    await until(
      () =>
        nativeWindowAction(app.child.pid!).some(
          (window) =>
            window.Class === 'Chrome_WidgetWin_1' && !window.Minimized && !window.Maximized,
        ),
      'window unmaximized',
    );
    const exited = once(app.child, 'exit');
    nativeWindowAction(app.child.pid!, 'close');
    await Promise.race([
      exited,
      new Promise((_accept, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Normal close did not terminate the app.')),
          10000,
        );
        timer.unref();
      }),
    ]);

    assert.equal(
      (
        JSON.parse(
          readFileSync(join(game, '.dev-container/window-layout.json'), 'utf8'),
        ) as WindowLayout
      ).mainWindowState.maximized,
      false,
    );
  },
);

await test(
  'preference adopts existing saved values without overriding a current preference file',
  { timeout: 120000 },
  async (t) => {
    /// @case A workspace has the previous state filename, or both the previous and current
    /// preference filenames.
    /// @expect Existing values survive the name change, current preference wins when both exist,
    /// and the D/C menu opens the same editable page.
    const expected = {
      version: 1,
      viewHost: 'iframe',
      layout: 'empty',
      saveLayout: false,
    };
    for (const currentExists of [false, true]) {
      const game = join(root, '.test-runs', 'preference-state-' + currentExists + '-' + Date.now());
      mkdirSync(join(game, '.dev-container'), { recursive: true });
      writeFileSync(
        join(game, 'dev-container.config.yaml'),
        JSON.stringify({ version: 1, game: { id: 'preference-state', title: 'Preference state' } }),
      );
      const previous = currentExists
        ? {
          version: 1,
          viewHost: 'webview',
          layout: 'saved',
          saveLayout: true,
        }
        : expected;
      writeFileSync(join(game, '.dev-container/settings.json'), JSON.stringify(previous));
      if (currentExists) {
        writeFileSync(join(game, '.dev-container/preference.json'), JSON.stringify(expected));
      }
      const app = await start(game, t);
      await app.page.getByText('从客户端菜单添加客户端', { exact: true }).waitFor();
      assert.equal((await app.descriptors()).length, 0);
      await app.page.getByRole('button', { name: 'Dev Container 菜单', exact: true }).click();
      await app.page
        .locator('.desktop-dropdown')
        .getByRole('button', { name: '偏好设置', exact: true })
        .click();
      const panel = app.page.getByRole('region', { name: '偏好设置', exact: true });
      await panel.waitFor();
      assert.equal(await panel.getByLabel('预览模式', { exact: true }).inputValue(), 'iframe');
      assert.equal(await panel.getByLabel('启动布局', { exact: true }).inputValue(), 'empty');
      assert.equal(await panel.getByLabel('保存布局', { exact: true }).isChecked(), false);
      assert.deepEqual(
        JSON.parse(readFileSync(join(game, '.dev-container/preference.json'), 'utf8')),
        expected,
      );
      assert.equal(existsSync(join(game, '.dev-container/settings.json')), currentExists);
      await app.stop();
    }
  },
);

for (const mode of ['webview', 'iframe']) {
  await test(
    mode + ' env launch defaults follow target files and preserve only explicit overrides',
    { timeout: 4 * 60000 },
    async (t) => {
      /// @case A game binds typed defaults to its root env files, saves an untouched form,
      /// overrides values and restarts after env changes.
      /// @expect Local env wins, defaults remain dynamic, explicit false/0 and omitted fields
      /// persist, and reset returns to the current defaults.
      const server = createServer((_req, res) => res.end('<html>Env preview</html>'));
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      t.after(() => server.close());
      const game = join(root, '.test-runs', 'env-' + mode + '-' + Date.now());
      mkdirSync(game, { recursive: true });
      prepareLaunchFiles(game, mode);
      writeEditorSession(game, (server.address() as AddressInfo).port);
      writeFileSync(join(game, 'dev-container.config.yaml'), configText(mode));
      writeFileSync(
        join(game, '.env'),
        'DC_TEST_COUNT=3\nDC_TEST_ENABLED=true\nDC_TEST_NAME="root value"\nDC_TEST_RATIO=0.25\n',
      );
      writeFileSync(join(game, '.env.local'), 'DC_TEST_COUNT=4\nDC_TEST_ENABLED=false\n');
      writeFileSync(join(game, 'client/.env.local'), 'DC_TEST_COUNT=9\n');
      writeFileSync(
        join(game, 'launch-params.schema.json'),
        JSON.stringify({
          ...launchSchema,
          properties: {
            ...launchSchema.properties,
            'count': {
              'type': 'integer',
              'minimum': 0,
              'maximum': 10,
              'x-default-env': 'DC_TEST_COUNT',
            },
            '--enabled': { 'type': 'boolean', 'x-default-env': 'DC_TEST_ENABLED' },
            'custom': { 'type': 'string', 'x-default-env': 'DC_TEST_NAME' },
            'ratio': {
              'type': 'number',
              'minimum': 0,
              'maximum': 1,
              'x-default-env': 'DC_TEST_RATIO',
            },
          },
        }),
      );
      let app = await start(game, t);
      assert.doesNotMatch(await app.page.locator('body').innerText(), /无法打开目标游戏/);
      const first = await until(async () => (await app.descriptors())[0], 'env defaults');
      let url = new URL(first.url);
      assert.equal(url.searchParams.get('count'), '4');
      assert.equal(url.searchParams.get('--enabled'), 'false');
      assert.equal(url.searchParams.get('custom'), 'root value');
      assert.equal(url.searchParams.get('ratio'), '0.25');
      await app.page.getByRole('button', { name: '打开启动配置', exact: true }).click();
      assert.equal(await app.page.getByLabel('count', { exact: true }).inputValue(), '4');
      await app.page.getByRole('button', { name: '保存并重启', exact: true }).click();
      await until(async () => {
        const current = (await app.descriptors())[0];
        return current && current.token !== first.token;
      }, 'saved inherited defaults');
      await until(() => {
        const state = JSON.parse(
          readFileSync(join(game, '.dev-container/window-layout.json'), 'utf8'),
        ) as WindowLayout;
        return Object.values(state.layoutState.dockView.panels).some(
          (panel) => Object.keys(panel.params.values).length === 0,
        );
      }, 'defaults not serialized as overrides');
      await app.stop();
      writeFileSync(join(game, '.env.local'), 'DC_TEST_COUNT=6\nDC_TEST_ENABLED=false\n');
      app = await start(game, t);
      const inherited = await until(
        async () => (await app.descriptors())[0],
        'updated env defaults',
      );
      assert.equal(new URL(inherited.url).searchParams.get('count'), '6');
      await app.page.getByRole('button', { name: '打开启动配置', exact: true }).click();
      await app.page.getByLabel('count', { exact: true }).fill('0');
      await app.page.getByLabel('count', { exact: true }).dispatchEvent('change');
      await app.page.getByLabel('custom', { exact: true }).fill('manual');
      await app.page.getByLabel('custom', { exact: true }).dispatchEvent('change');
      await app.page.getByLabel('设置 --enabled', { exact: true }).uncheck();
      await app.page.getByRole('button', { name: '保存并重启', exact: true }).click();
      await until(async () => {
        const current = (await app.descriptors())[0];
        return current && current.token !== inherited.token;
      }, 'explicit override saved');
      await app.close();
      writeFileSync(join(game, '.env.local'), 'DC_TEST_COUNT=7\nDC_TEST_ENABLED=true\n');
      app = await start(game, t);
      const overridden = await until(
        async () => (await app.descriptors())[0],
        'explicit overrides after restart',
      );
      url = new URL(overridden.url);
      assert.equal(url.searchParams.get('count'), '0');
      assert.equal(url.searchParams.get('custom'), 'manual');
      assert.equal(url.searchParams.has('--enabled'), false);
      await app.page.getByRole('button', { name: '打开启动配置', exact: true }).click();
      await app.page.getByRole('button', { name: '恢复默认', exact: true }).click();
      await app.page.getByRole('button', { name: '保存并重启', exact: true }).click();
      const reset = await until(async () => {
        const current = (await app.descriptors())[0];
        return current?.token !== overridden.token && current;
      }, 'reset clears explicit overrides');
      url = new URL(reset.url);
      assert.equal(url.searchParams.get('count'), '7');
      assert.equal(url.searchParams.get('--enabled'), 'true');
      assert.equal(url.searchParams.get('custom'), 'root value');
      await app.page.getByRole('button', { name: '打开启动配置', exact: true }).click();
      await app.page.getByLabel('--enabled', { exact: true }).locator('..').click();
      await app.page.getByRole('button', { name: '保存并重启', exact: true }).click();
      await until(async () => {
        const current = (await app.descriptors())[0];
        return current && new URL(current.url).searchParams.get('--enabled') === 'false';
      }, 'explicit false overrides true default');
      await app.close();
      app = await start(game, t);
      const explicitFalse = await until(
        async () => (await app.descriptors())[0],
        'false override after restart',
      );
      assert.equal(new URL(explicitFalse.url).searchParams.get('--enabled'), 'false');
    },
  );
}

await test(
  'env launch defaults reject missing variables and invalid typed or constrained values',
  { timeout: 3 * 60000 },
  async (t) => {
    /// @case A schema binds a missing, empty, mistyped, out-of-range or conflicting environment
    /// default.
    /// @expect Configuration diagnostics identify the schema, field and variable; invalid defaults
    /// never launch a client.
    const cases = [
      {
        field: { 'type': 'integer', 'x-default-env': 'DC_BAD' },
        env: '',
        reason: /not defined/,
      },
      {
        field: { 'type': 'integer', 'x-default-env': 'DC_BAD' },
        env: 'DC_BAD=\n',
        reason: /number/,
      },
      {
        field: { 'type': 'integer', 'x-default-env': 'DC_BAD' },
        env: 'DC_BAD=1.5\n',
        reason: /integer/,
      },
      {
        field: { 'type': 'number', 'x-default-env': 'DC_BAD' },
        env: 'DC_BAD=NaN\n',
        reason: /number/,
      },
      {
        field: {
          'type': 'integer',
          'maximum': 10,
          'x-default-env': 'DC_BAD',
        },
        env: 'DC_BAD=11\n',
        reason: /<= 10/,
      },
      {
        field: { 'type': 'boolean', 'x-default-env': 'DC_BAD' },
        env: 'DC_BAD=yes\n',
        reason: /true or false/,
      },
      {
        field: {
          'type': 'string',
          'enum': ['allowed'],
          'x-default-env': 'DC_BAD',
        },
        env: 'DC_BAD=other\n',
        reason: /allowed values/,
      },
      {
        field: {
          'type': 'string',
          'minLength': 2,
          'x-default-env': 'DC_BAD',
        },
        env: 'DC_BAD=x\n',
        reason: /fewer than 2/,
      },
      {
        field: {
          'type': 'integer',
          'default': 1,
          'x-default-env': 'DC_BAD',
        },
        env: 'DC_BAD=2\n',
        reason: /both default/,
      },
      {
        field: { 'type': 'integer', 'x-default-env': '' },
        env: '',
        reason: /non-empty/,
      },
    ];
    for (const [index, scenario] of cases.entries()) {
      const game = join(root, '.test-runs', 'env-invalid-' + Date.now() + '-' + index);
      mkdirSync(game, { recursive: true });
      writeFileSync(join(game, 'dev-container.config.yaml'), configText('webview'));
      writeFileSync(join(game, '.env.local'), scenario.env);
      writeFileSync(
        join(game, 'launch-params.schema.json'),
        JSON.stringify({
          type: 'object',
          additionalProperties: false,
          properties: { count: scenario.field },
        }),
      );
      const app = await start(game, t);
      const text = await app.page.locator('body').innerText();
      assert.match(text, /launch-params.schema.json/);
      assert.match(text, /count/);
      if (index < 9) {
        assert.match(text, /DC_BAD/);
      }
      assert.match(text, scenario.reason);
      await app.stop();
    }
  },
);
