import { session, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { fileURLToPath } from 'node:url';
import {
  type SdkCommand,
  guestPreparationIpcChannel,
  sdkIpcChannel,
  sdkEventChannel,
} from '@bsgames/dev-container-api/sdk-protocol';
import { ClientViewHostMode } from '@bsgames/dev-container-api/game-config';
import { registerClientViewHandler } from './client-view-protocol.js';
import type { Runtime } from './host-runtime.js';
import type { PreferenceStore } from './preference-store.js';
import type { ConfigStore } from './config-store.js';
import { devContainerIpcChannels, type DevContainerLayoutState } from '../shared/ipc-contract.js';
export function registerIpcHandlers(
  window: BrowserWindow,
  runtime: Runtime,
  configStore: ConfigStore,
  preferenceStore: PreferenceStore,
) {
  const extensionHandlers = new Map<string, Map<string, (payload: unknown) => unknown>>();
  const guestTokens = new Map<number, string>();
  const registeredGuests = new Set<number>();
  const assertRoot = (event: IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Rejected IPC from an unregistered renderer.');
    }
  };
  ipcMain.handle(devContainerIpcChannels.getLaunchOptions, (event) => {
    assertRoot(event);
    return {
      layoutSource: runtime.preference.layout,
      saveLayout: runtime.preference.saveLayout,
    };
  });
  ipcMain.handle(devContainerIpcChannels.getPreference, (event) => {
    assertRoot(event);
    return preferenceStore.preference;
  });
  ipcMain.handle(devContainerIpcChannels.savePreference, (event, value: unknown) => {
    assertRoot(event);
    return preferenceStore.save(value);
  });
  ipcMain.handle(devContainerIpcChannels.getExtensionLaunchArgs, (event) => {
    assertRoot(event);
    return {};
  });
  ipcMain.handle(devContainerIpcChannels.loadLayoutState, (event) => {
    assertRoot(event);
    return configStore.layoutState;
  });
  ipcMain.handle(
    devContainerIpcChannels.saveLayoutState,
    (event, state: DevContainerLayoutState) => {
      assertRoot(event);
      return configStore.setLayoutState(state);
    },
  );
  ipcMain.handle(devContainerIpcChannels.invokeExtension, async (event, request) => {
    assertRoot(event);
    if (
      !request
      || typeof request.extensionId !== 'string'
      || typeof request.command !== 'string'
    ) {
      throw new Error('Invalid extension request.');
    }
    const handler = extensionHandlers.get(request.extensionId)?.get(request.command);
    if (!handler) {
      throw new Error('Unknown extension command: ' + request.extensionId + ':' + request.command);
    }
    return handler(request.payload);
  });
  ipcMain.handle('dev-container:iframe-sdk:prepare', (event, token: string) => {
    assertRoot(event);
    const descriptor = runtime.findBinding(token);
    if (descriptor.viewHost !== ClientViewHostMode.iframe) {
      throw new Error('Not an iframe client.');
    }
    runtime.attachSender(token, (event) =>
      window.webContents.send('dev-container:iframe-sdk:event', { token, event }),
    );
  });
  ipcMain.handle('dev-container:iframe-sdk', (event, request) => {
    assertRoot(event);
    if (runtime.findBinding(request.token).viewHost !== ClientViewHostMode.iframe) {
      throw new Error('Not an iframe client.');
    }
    return runtime.request(request.token, request.command);
  });
  window.webContents.on('will-attach-webview', (event, preferences, params) => {
    try {
      const token = new URL(params.src).searchParams.get('__devContainerClient');
      if (!token) {
        throw new Error('Webview has no registered client token.');
      }
      const descriptor = runtime.findBinding(token);
      if (descriptor.viewHost !== ClientViewHostMode.webview || params.src !== descriptor.url) {
        throw new Error('Webview does not match the registered client.');
      }
      preferences.session = session.fromPartition(descriptor.partition);
      delete preferences.partition;
      registerClientViewHandler(runtime, preferences.session, ClientViewHostMode.webview);
      preferences.additionalArguments = ['--dev-container-client=' + token];
      preferences.preload = fileURLToPath(new URL('../preload/guest.mjs', import.meta.url));
      preferences.nodeIntegration = false;
      preferences.contextIsolation = true;
      preferences.sandbox = false;
      preferences.backgroundThrottling = false;
    } catch (error) {
      event.preventDefault();
      console.error(error);
    }
  });
  window.webContents.on('did-attach-webview', (_event, guest) => {
    registeredGuests.add(guest.id);
    guest.on('destroyed', () => {
      guestTokens.delete(guest.id);
      registeredGuests.delete(guest.id);
    });
  });
  ipcMain.on(guestPreparationIpcChannel, (event, request: { token: string }) => {
    try {
      if (!registeredGuests.has(event.sender.id) || event.senderFrame !== event.sender.mainFrame) {
        throw new Error('SDK preparation from an unregistered guest.');
      }
      const descriptor = runtime.findBinding(request.token);
      if (
        descriptor.viewHost !== ClientViewHostMode.webview
        || event.sender.session !== session.fromPartition(descriptor.partition)
      ) {
        throw new Error('Guest session does not match its registered user.');
      }
      guestTokens.set(event.sender.id, request.token);
      const guest = event.sender;
      runtime.attachSender(request.token, (event) => {
        if (!guest.isDestroyed()) {
          guest.send(sdkEventChannel, event);
        }
      });
      event.returnValue = {};
    } catch (error) {
      event.returnValue = { error: String(error) };
      window.webContents.send('dev-container:diagnostic', String(error));
    }
  });
  ipcMain.handle(sdkIpcChannel, (event, request: { command: SdkCommand }) => {
    const token = guestTokens.get(event.sender.id);
    if (!token || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('SDK request from an unprepared guest.');
    }
    const descriptor = runtime.findBinding(token);
    const guestUrl = new URL(event.sender.getURL());
    const clientUrl = new URL(descriptor.url);
    if (guestUrl.protocol !== clientUrl.protocol || guestUrl.host !== clientUrl.host) {
      throw new Error('Guest origin does not match its registered user.');
    }
    return runtime.request(token, request.command);
  });
  return {
    handleExtension(extensionId: string, command: string, handler: (payload: unknown) => unknown) {
      let handlers = extensionHandlers.get(extensionId);
      if (!handlers) {
        handlers = new Map();
        extensionHandlers.set(extensionId, handlers);
      }
      if (handlers.has(command)) {
        throw new Error('Duplicate extension command: ' + extensionId + ':' + command);
      }
      handlers.set(command, handler);
    },
  };
}
