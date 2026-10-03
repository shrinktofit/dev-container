import type { DevContainerPreference, DevContainerRendererApi } from '@bsgames/dev-container-api';

export const devContainerIpcChannels = {
  getExtensionLaunchArgs: 'dev-container:extension:launch-args',
  getLaunchOptions: 'dev-container:launch-options',
  getPreference: 'dev-container:preference:get',
  savePreference: 'dev-container:preference:save',
  loadLayoutState: 'dev-container:layout:load',
  saveLayoutState: 'dev-container:layout:save',
  invokeExtension: 'dev-container:extension:invoke',
} as const;

export type DevContainerLayoutSource = 'default' | 'empty' | 'saved';

export interface DevContainerRendererLaunchOptions {
  readonly layoutSource: DevContainerLayoutSource;
  readonly saveLayout: boolean;
}

export interface DevContainerLayoutState {
  version: 1;
  dockView: unknown;
}

export interface DevContainerExtensionInvokeRequest {
  extensionId: string;
  command: string;
  payload?: unknown;
}

export interface DevContainerApi extends DevContainerRendererApi {
  onDiagnostic(listener: (message: string) => void): () => void;
  prepareIframeSdk(token: string): Promise<void>;
  invokeIframeSdk(token: string, command: string): Promise<unknown>;
  onIframeSdkEvent(listener: (message: unknown) => void): () => void;
  getPreference(): Promise<DevContainerPreference>;
  savePreference(value: DevContainerPreference): Promise<void>;
  getLaunchOptions(): Promise<DevContainerRendererLaunchOptions>;
  loadLayoutState(): Promise<DevContainerLayoutState | undefined>;
  saveLayoutState(state: DevContainerLayoutState): Promise<void>;
}
