import type { DevContainerPanelOptions } from './index.ts';

export type DevContainerLayoutCommand
  = | {
    type: 'addPanel';
    panel: DevContainerPanelOptions;
  }
  | {
    type: 'removePanel';
    panelId: string;
  }
  | {
    type: 'updatePanel';
    panelId: string;
    title?: string;
    params?: Record<string, unknown>;
  }
  | {
    type: 'resetLayout';
  };

type DevContainerLayoutCommandListener = (command: DevContainerLayoutCommand) => void;

const listeners = new Set<DevContainerLayoutCommandListener>();

export function dispatchDevContainerLayoutCommand(command: DevContainerLayoutCommand) {
  for (const listener of listeners) {
    listener(command);
  }
}

export function addDevContainerLayoutCommandListener(listener: DevContainerLayoutCommandListener) {
  listeners.add(listener);
  return {
    dispose() {
      listeners.delete(listener);
    },
  };
}
