import { app, BrowserWindow, dialog, Menu, session } from 'electron';
import { mkdirSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import yargs from 'yargs/yargs';
import { loadGameConfig } from './game-config.js';
import { ClientViewHostMode } from '@bsgames/dev-container-api/game-config';
import { PreferenceStore } from './preference-store.js';
import { readDebugEndpoint } from './debug-endpoint.js';
import type { DevContainerDebugInfo } from '@bsgames/dev-container-api';
import { ConfigStore } from './config-store.js';
import { Runtime } from './host-runtime.js';
import { WindowManager } from './window-manager.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { registerClientViewPrivileges, registerClientViewHandler } from './client-view-protocol.js';
import { devContainerMainExtensions } from '../extensions/main-extensions.js';
const argv = process.argv.slice(app.isPackaged ? 1 : 2);
let probe = false;
let runtime: Runtime | undefined;
let rootWindow: BrowserWindow | undefined;

async function start(): Promise<void> {
  let args;
  try {
    args = yargs(argv)
      .scriptName('dev-container')
      .command('$0 <directory>', 'Open the target game in Dev Container', (command) =>
        command.positional('directory', { type: 'string', description: 'Target game directory' }))
      .command(
        'probe <directory>',
        'Check whether the target game already has an instance',
        (command) => command.positional('directory', {
          type: 'string',
          description: 'Target game directory',
        }),
      )
      .option('remote-debugging-port', {
        type: 'number',
        requiresArg: true,
        description: 'Enable remote debugging (0 selects an available port)',
      })
      .option('inspect', {
        type: 'string',
        requiresArg: true,
        description: 'Electron main-process inspector address',
      })
      .option('force-device-scale-factor', {
        type: 'number',
        requiresArg: true,
        description: 'Chromium display scale factor',
      })
      .strict()
      .version(false)
      .help()
      .exitProcess(false)
      .check((values) => {
        if (values.help) {
          return true;
        }
        if (typeof values.directory !== 'string' || !values.directory.trim()) {
          throw new Error('directory requires a target folder.');
        }
        const port = values['remote-debugging-port'];
        if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
          throw new Error('--remote-debugging-port requires 0 or a port between 1 and 65535.');
        }
        return true;
      })
      .fail((message, error) => {
        throw error ?? new Error(message);
      })
      .parseSync();
  } catch (error) {
    process.stderr.write(String(error) + '\n', () => app.exit(2));
    return;
  }
  if (args.help) {
    app.exit(0);
    return;
  }
  probe = args._[0] === 'probe';
  const targetDirectory = realpathSync.native(resolve(args.directory as string));
  const stateDirectory = join(targetDirectory, '.dev-container');
  const userData = join(stateDirectory, 'electron/user-data');
  mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
  const ownsLock = app.requestSingleInstanceLock({ targetDirectory });
  if (probe) {
    if (ownsLock) {
      app.releaseSingleInstanceLock();
    }
    process.stdout.write(JSON.stringify({ running: !ownsLock }) + '\n', () => {
      app.exit(ownsLock ? 1 : 0);
    });
    return;
  }
  if (!ownsLock) {
    await app.whenReady();
    await dialog.showMessageBox({
      type: 'error',
      title: '项目已打开',
      message: '该项目已在 Dev Container 中打开，不能重复启动。',
      detail: targetDirectory,
      buttons: ['确定'],
      noLink: true,
    });
    app.quit();
    return;
  }
  for (const [name, child] of [
    ['sessionData', 'electron/session-data'],
    ['logs', 'electron/logs'],
    ['crashDumps', 'electron/crash-dumps'],
    ['temp', 'electron/temp'],
  ] as const) {
    const path = join(stateDirectory, child);
    mkdirSync(path, {
      recursive: true,
    });
    app.setPath(name, path);
  }
  const debugPort = args['remote-debugging-port'];
  registerClientViewPrivileges();
  let config;
  try {
    config = loadGameConfig(targetDirectory);
  } catch (error) {
    await app.whenReady();
    rootWindow = new BrowserWindow({
      width: 960,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: session.fromPartition('persist:dev-container'),
      },
    });
    const text = String(error)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    await rootWindow.loadURL(
      'data:text/html;charset=utf-8,'
      + encodeURIComponent(
        (
          '<html><head><title>Dev Container configuration '
          + 'error</title></head><body '
          + (
            'style="font-family:sans-serif;padding:32px"><h1>无法打开目标游戏</h1>'
            + '<pre style="white-space:pre-wrap">'
          )
        )
        + text
        + '</pre></body></html>',
      ),
    );
    console.error(error);
    return;
  }
  if (debugPort === 0) {
    rmSync(join(app.getPath('sessionData'), 'DevToolsActivePort'), { force: true });
  }
  await app.whenReady();
  Menu.setApplicationMenu(null);
  const preferenceStore = await PreferenceStore.open(stateDirectory);
  const preference = preferenceStore.preference;
  let debugInfo: DevContainerDebugInfo = {};
  let debugError: string | undefined;
  try {
    debugInfo = await readDebugEndpoint(debugPort);
  } catch (error) {
    debugError = String(error);
    console.error(error);
  }
  runtime = await Runtime.open(config, preference, debugInfo, stateDirectory);
  await runtime.saveDebugSession();
  const hostSession = session.fromPartition('persist:dev-container');
  registerClientViewHandler(runtime, hostSession, ClientViewHostMode.iframe);
  const configStore = new ConfigStore(stateDirectory);
  await configStore.load();
  const manager = new WindowManager();
  rootWindow = manager.createMainWindow({
    configStore,
    session: hostSession,
  });
  if (preference.viewHost === 'iframe') {
    rootWindow.webContents.setAudioMuted(true);
  }
  const registry = registerIpcHandlers(rootWindow, runtime, configStore, preferenceStore);
  for (const extension of devContainerMainExtensions) {
    await extension.activate({
      workspacePath: stateDirectory,
      targetDirectory,
      mainWindow: rootWindow,
      configStore,
      runtime,
      launchArgs: {},
      debugInfo,
      extensionIpc: {
        handle: (command, handler) => registry.handleExtension(extension.id, command, handler),
      },
    });
  }
  let closing = false;
  rootWindow.on('close', (event) => {
    event.preventDefault();
    if (closing) {
      return;
    }
    closing = true;
    (async () => {
      for (const descriptor of runtime!.listDebugClients()) {
        await runtime!.releaseClient(descriptor.token);
      }
      await configStore.flush();
      // Native window destruction remains usable when a renderer stops responding.
      rootWindow!.destroy();
    })()
      .catch(async (error) => {
        console.error(error);
        const { response } = await dialog.showMessageBox(rootWindow!, {
          type: 'warning',
          title: '无法安全关闭',
          message: '无法保存宿主状态',
          detail:
            '可以返回应用后重试，或强制退出。强制退出可能丢失尚未完成写入的数据。\n\n'
            + String(error),
          buttons: ['返回应用', '强制退出'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (response === 1) {
          app.exit(0);
        }
      })
      .finally(() => {
        closing = false;
      })
      .catch((error) => console.error(error));
  });

  await manager.loadMainWindow(rootWindow);
  rootWindow.setTitle(config.game.title + ' · Dev Container');
  if (debugError) {
    rootWindow.webContents.send('dev-container:diagnostic', debugError);
  }
}

start().catch((error) => {
  if (probe) {
    process.stderr.write(String(error) + '\n', () => app.exit(2));
    return;
  }
  console.error(error);
  void app.whenReady().then(() => {
    dialog.showErrorBox('Dev Container startup failed', String(error));
    app.quit();
  });
});
app.on('window-all-closed', () => app.quit());
