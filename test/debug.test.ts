import process from 'node:process';
import { test, type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { DebugSession, WindowLayout } from './fixture-types.ts';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const require = createRequire(root + '/packages/dev-container/package.json');
const shared = createRequire(
  (process.env.DEV_CONTAINER_PLAYWRIGHT_ROOT ?? 'U:/AgentTools/playwright') + '/package.json',
);
const CDP: typeof import('chrome-remote-interface') = shared('chrome-remote-interface');
const sleep = (ms: number) => new Promise((accept) => setTimeout(accept, ms));

async function until<T>(
  check: () => T | Promise<T>,
  description: string,
): Promise<Exclude<T, undefined | null | false>> {
  for (let attempt = 0; attempt < 150; attempt++) {
    const value = await check();
    if (value) {
      return value as Exclude<T, undefined | null | false>;
    }
    await sleep(100);
  }
  throw new Error('Timed out: ' + description);
}

function target(mode: string, empty = false) {
  const game = join(root, '.test-runs', 'debug-' + mode + '-' + Date.now());
  mkdirSync(join(game, '.dev-container'), { recursive: true });
  writeFileSync(
    join(game, 'dev-container.config.yaml'),
    JSON.stringify({ version: 1, game: { id: 'debug-test', title: 'Debug test' } }),
  );
  writeFileSync(
    join(game, '.dev-container/preference.json'),
    JSON.stringify({
      version: 1,
      viewHost: mode,
      layout: empty ? 'empty' : 'saved',
      saveLayout: true,
    }),
  );
  return game;
}

function debugSession(game: string) {
  try {
    return JSON.parse(
      readFileSync(join(game, '.dev-container/debug-session.json'), 'utf8'),
    ) as DebugSession;
  } catch {
    return undefined;
  }
}

function launch(
  game: string,
  args: string[],
  t: TestContext,
  packaged = process.env.DEV_CONTAINER_TEST_PACKAGED === '1',
) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const binary: string = packaged
    ? join(root, 'packages/dev-container/.deploy/dist/win-unpacked/Dev Container.exe')
    : require('electron');
  const child = spawn(
    binary,
    [
      ...(packaged ? [] : [join(root, 'packages/dev-container')]),
      '--game',
      game,
      ...args,
    ],
    {
      env,
      cwd: root,
      windowsHide: true,
      stdio: [
        'ignore',
        'pipe',
        'pipe',
      ],
    },
  );
  let logs = '';
  child.stderr.on('data', (data) => (logs += data));
  t.after(async () => {
    child.kill();
    await sleep(300);
  });
  return { child, logs: () => logs };
}

await test(
  'automatic debug ports isolate targets and ordinary launches clear stale endpoints',
  { timeout: 60000 },
  async (t) => {
    /// @case Two target games use an OS-assigned debug port, then one restarts without a remote
    /// switch and has no clients.
    /// @expect Each debug target reports its own live endpoint; ordinary startup records the new
    /// PID and null addresses with an empty client list.
    const games = [target('webview', true), target('iframe', true)];
    const apps = games.map((game) => launch(game, ['--remote-debugging-port=0'], t));
    const sessions = await Promise.all(
      apps.map((app, index) =>
        until(() => {
          const session = debugSession(games[index]);
          return (
            session !== undefined
            && session.pid === app.child.pid
            && session.remoteDebuggingPort !== null
            && session.remoteDebuggingPort > 0
            && session
          );
        }, 'automatic endpoint'),
      ),
    );
    assert.notEqual(sessions[0].remoteDebuggingPort, sessions[1].remoteDebuggingPort);
    for (const [index, session] of sessions.entries()) {
      assert.deepEqual(session.clients, []);
      const version = await (await fetch(session.devtoolsHttpOrigin + '/json/version')).json();
      assert.equal(new URL(version.webSocketDebuggerUrl).port, String(session.remoteDebuggingPort));
      apps[index].child.kill();
      await once(apps[index].child, 'exit');
    }
    const ordinary = launch(games[0], [], t);
    const session = await until(() => {
      const value = debugSession(games[0]);
      return value?.pid === ordinary.child.pid && value;
    }, 'ordinary process metadata');
    assert.equal(session.remoteDebuggingPort, null);
    assert.equal(session.devtoolsHttpOrigin, null);
    assert.deepEqual(session.clients, []);
  },
);
for (const mode of ['webview', 'iframe']) {
  await test(
    mode + ' built-in DevTools and mute/window restoration do not require a remote port',
    { timeout: 60000 },
    async (t) => {
      /// @case An ordinary host opens the client DevTools manually, unmutes its client and resizes
      /// the window before restarting.
      /// @expect Only the intended DevTools opens; mute and window state restore while renderer
      /// remote debugging stays disabled.
      const server = createServer((_request, response) =>
        response.end('<html>DevTools preview</html>'),
      );
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      t.after(() => server.close());
      const game = target(mode);
      mkdirSync(join(game, 'temp'));
      writeFileSync(
        join(game, 'temp/editor-session.json'),
        JSON.stringify({
          'schemaVersion': 1,
          'server.port': (server.address() as AddressInfo).port,
          'editor.pid': process.pid,
        }),
      );

      async function start() {
        // Inspect the public Electron window APIs via Node's main-process inspector; do not enable
        // a renderer remote port.
        // Use deterministic DIP bounds so Windows display scaling does not round resize assertions.
        const app = launch(game, ['--inspect=0', '--force-device-scale-factor=1'], t, false);
        const endpoint = await until(
          () => /Debugger listening on (ws:\/\/[^\s]+)/u.exec(app.logs())?.[1],
          'Node inspector',
        );
        const inspector = await CDP({ target: endpoint });
        t.after(() => inspector.close().catch(() => {
        }));
        await inspector.Runtime.enable();
        await until(async () => {
          const session = debugSession(game);
          return (
            session !== undefined && session.pid === app.child.pid && session.clients.length === 1
          );
        }, 'ordinary client');

        async function evaluate(body: string): Promise<unknown> {
          const result = await inspector.Runtime.evaluate({
            expression:
              (
                '(async () => { const { BrowserWindow, webContents } = '
                + (
                  'process.getBuiltinModule("module").createRequire(process.'
                  + 'cwd() + "/packages/dev-container/package.json")("electron"); '
                  + 'const host = BrowserWindow.getAllWindows()[0]; '
                )
              )
              + body
              + ' })()',
            awaitPromise: true,
            returnByValue: true,
          });
          if (result.exceptionDetails) {
            throw new Error(JSON.stringify(result.exceptionDetails));
          }
          return result.result.value;
        }

        return {
          app,
          inspector,
          evaluate,
        };
      }

      let { app, inspector, evaluate } = await start();
      await until(
        () =>
          evaluate(
            'return webContents.getAllWebContents().some((view) => view.getType() === "webview");',
          ).then((ready) => mode === 'iframe' || ready),
        'ready guest',
      );
      assert.equal(debugSession(game)!.remoteDebuggingPort, null);
      assert.equal(await evaluate('return host.webContents.isDevToolsOpened();'), false);
      await evaluate(
        'await host.webContents.executeJavaScript('
        + JSON.stringify(
          (
            'Array.from(document.querySelectorAll("button")).'
            + 'find((button) => button.textContent.trim() === "DevTools").'
            + 'click()'
          ),
        )
        + ');',
      );
      await until(
        () =>
          evaluate(
            mode === 'webview'
              ? (
                'return webContents.getAllWebContents().some((view) => '
                + 'view.getType() === "webview" && view.isDevToolsOpened());'
              )
              : 'return host.webContents.isDevToolsOpened();',
          ),
        'manual DevTools',
      );
      if (mode === 'webview') {
        assert.equal(await evaluate('return host.webContents.isDevToolsOpened();'), false);
      }
      await evaluate(
        (
          'for (const view of webContents.getAllWebContents()) { if '
          + '(view.isDevToolsOpened()) view.closeDevTools(); } '
          + 'host.setBounds({ x: 80, y: 80, width: 1100, height: 750 }); '
          + 'await host.webContents.executeJavaScript('
        )
        + JSON.stringify('document.querySelector(".client-panel [aria-label=取消静音]").click()')
        + ');',
      );
      await until(() => {
        const state = JSON.parse(
          readFileSync(join(game, '.dev-container/window-layout.json'), 'utf8'),
        ) as WindowLayout;
        const panels = Object.values(state.layoutState?.dockView.panels ?? {});
        return (
          state.mainWindowState?.bounds.width === 1100
          && panels.some((panel) => panel.params?.muted === false)
        );
      }, 'saved window and mute');
      const closed = once(app.child, 'exit');
      await evaluate('setTimeout(() => host.close(), 100);');
      await inspector.close();
      await closed;
      ({ app, inspector, evaluate } = await start());
      await until(
        () =>
          evaluate(
            mode === 'webview'
              ? (
                'return webContents.getAllWebContents().some((view) => '
                + 'view.getType() === "webview" && !view.isAudioMuted());'
              )
              : 'return !host.webContents.isAudioMuted();',
          ),
        'restored mute',
      );
      assert.equal(await evaluate('return host.getBounds().width;'), 1100);
      assert.equal(debugSession(game)!.remoteDebuggingPort, null);
    },
  );
}
