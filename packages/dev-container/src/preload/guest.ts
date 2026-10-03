import process from 'node:process';
import { contextBridge, ipcRenderer } from 'electron';
import {
  guestPreparationIpcChannel,
  sdkEventChannel,
  sdkIpcChannel,
  SdkCommand,
  type SdkEvent,
} from '@bsgames/dev-container-api/sdk-protocol';
import { createRuntimeSdk } from '@bsgames/dev-container-api/sdk-runtime';
const token = process.argv
  .find((value) => value.startsWith('--dev-container-client='))
  ?.slice('--dev-container-client='.length);
// Only the isolated preload can prepare the guest. The game receives account operations.
const preparation = ipcRenderer.sendSync(guestPreparationIpcChannel, { token }) as {
  error?: string;
};
let disconnectMessage = preparation.error;
ipcRenderer.on(sdkEventChannel, (_event, event: SdkEvent) => {
  disconnectMessage = event.message;
});
contextBridge.exposeInMainWorld(
  '__devContainer',
  createRuntimeSdk(async (command) => {
    if (disconnectMessage) {
      throw new Error(disconnectMessage);
    }
    return ipcRenderer.invoke(sdkIpcChannel, { command });
  }, SdkCommand),
);
