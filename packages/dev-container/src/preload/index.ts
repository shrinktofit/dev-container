import { contextBridge, ipcRenderer } from 'electron';
import { devContainerIpcChannels, type DevContainerApi } from '../shared/ipc-contract.js';
contextBridge.exposeInMainWorld('devContainer', {
  onDiagnostic(listener: (message: string) => void) {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => listener(message);
    ipcRenderer.on('dev-container:diagnostic', handler);
    return () => {
      ipcRenderer.removeListener('dev-container:diagnostic', handler);
    };
  },
  getPreference: () => ipcRenderer.invoke(devContainerIpcChannels.getPreference),
  savePreference: (value) => ipcRenderer.invoke(devContainerIpcChannels.savePreference, value),
  getLaunchOptions: () => ipcRenderer.invoke(devContainerIpcChannels.getLaunchOptions),
  getExtensionLaunchArgs: (extensionId: string) =>
    ipcRenderer.invoke(devContainerIpcChannels.getExtensionLaunchArgs, extensionId),
  invokeExtension: (extensionId: string, command: string, payload?: unknown) =>
    ipcRenderer.invoke(devContainerIpcChannels.invokeExtension, {
      extensionId,
      command,
      payload,
    }),
  loadLayoutState: () => ipcRenderer.invoke(devContainerIpcChannels.loadLayoutState),
  saveLayoutState: (state: unknown) =>
    ipcRenderer.invoke(devContainerIpcChannels.saveLayoutState, state),
  prepareIframeSdk: (token: string) =>
    ipcRenderer.invoke('dev-container:iframe-sdk:prepare', token),
  invokeIframeSdk: (token: string, command: string) =>
    ipcRenderer.invoke('dev-container:iframe-sdk', {
      token,
      command,
    }),
  onIframeSdkEvent(listener: (message: unknown) => void) {
    const handler = (_event: Electron.IpcRendererEvent, message: unknown) => listener(message);
    ipcRenderer.on('dev-container:iframe-sdk:event', handler);
    return () => {
      ipcRenderer.removeListener('dev-container:iframe-sdk:event', handler);
    };
  },
} satisfies DevContainerApi);
