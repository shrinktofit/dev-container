import type { HostRuntime } from './game-config.js';
export * from './game-config.js';
import { defineComponent, h, type Component, type PropType } from 'vue';

export interface DevContainerMainWindow {
  readonly webContents: {
    setAudioMuted(muted: boolean): void;
    openDevTools(): void;
    readonly mainFrame: {
      readonly framesInSubtree: ReadonlyArray<{ readonly url: string; reload(): void }>;
    };
  };
}

export interface DevContainerMainContext {
  readonly workspacePath: string;
  readonly targetDirectory: string;
  readonly runtime: HostRuntime;
  readonly mainWindow: DevContainerMainWindow;
  readonly configStore: unknown;
  readonly debugInfo: DevContainerDebugInfo;
  readonly extensionIpc: DevContainerMainExtensionIpc;
  readonly launchArgs: DevContainerExtensionLaunchArgs;
}

export interface DevContainerDebugInfo {
  readonly remoteDebuggingPort?: number;
  readonly devtoolsHttpOrigin?: string;
}

export type DevContainerExtensionLaunchArgValue = boolean | string;

export type DevContainerExtensionLaunchArgs = Readonly<
  Record<string, DevContainerExtensionLaunchArgValue>
>;

export type DevContainerExtensionIpcHandler = (payload: unknown) => unknown;

export interface DevContainerMainExtensionIpc {
  handle(command: string, handler: DevContainerExtensionIpcHandler): void;
}

export interface DevContainerMainExtension {
  readonly id: string;
  activate(ctx: DevContainerMainContext): Promise<void> | void;
}

export type DevContainerPanelRenderer = 'always' | 'onlyWhenVisible';

export type DevContainerPanelPositionDirection = 'above' | 'below' | 'left' | 'right' | 'within';

export interface DevContainerPanelPosition {
  readonly direction: DevContainerPanelPositionDirection;
  readonly referencePanel?: string;
}

export interface DevContainerPanelOptions {
  readonly id: string;
  readonly component: string;
  readonly title?: string;
  readonly tabComponent?: string;
  readonly renderer?: DevContainerPanelRenderer;
  readonly params?: Record<string, unknown>;
  readonly position?: DevContainerPanelPosition;
  readonly minimumWidth?: number;
  readonly maximumWidth?: number;
  readonly initialWidth?: number;
  readonly minimumHeight?: number;
  readonly maximumHeight?: number;
  readonly initialHeight?: number;
}

export interface DevContainerDefaultPanelContribution {
  readonly order: number;
  readonly panel: DevContainerPanelOptions;
}

export interface DevContainerMenuActionGroup {
  readonly id: string;
  readonly label: string;
  readonly order: number;
}

export interface DevContainerMenuActionContribution {
  readonly id: string;
  readonly label: string;
  readonly group?: DevContainerMenuActionGroup;
  readonly order: number;
  run(): Promise<void> | void;
}

export interface DevContainerRendererLayoutContext {
  addPanel(panel: DevContainerPanelOptions): void;
  hasPanels(): boolean;
  removePanel(panelId: string): void;
  resetLayout(): void;
}

export type DevContainerRendererLayoutSource = 'saved' | 'default' | 'empty';

export interface DevContainerRendererReadyContext {
  readonly restoredLayout: boolean;
  readonly layoutSource: DevContainerRendererLayoutSource;
  readonly layout: DevContainerRendererLayoutContext;
}

export interface DevContainerRendererExtension {
  readonly id: string;
  readonly panels: Record<string, Component>;
  readonly tabComponents?: Record<string, Component>;
  readonly defaultPanels?: readonly DevContainerDefaultPanelContribution[];
  readonly menuActions?: readonly DevContainerMenuActionContribution[];
  afterLayoutReady?(ctx: DevContainerRendererReadyContext): Promise<void> | void;
  beforeSaveLayout?(dockViewLayout: unknown): unknown;
  migrateLayout?(dockViewLayout: unknown): unknown;
}

export interface DevContainerRendererApi {
  getExtensionLaunchArgs(extensionId: string): Promise<DevContainerExtensionLaunchArgs>;
  invokeExtension(extensionId: string, command: string, payload?: unknown): Promise<unknown>;
}

export function getDevContainerExtensionLaunchArgs(
  extensionId: string,
): Promise<DevContainerExtensionLaunchArgs> {
  return getDevContainerRendererApi().getExtensionLaunchArgs(extensionId);
}

export function invokeDevContainerExtension<TResponse = unknown>(
  extensionId: string,
  command: string,
  payload?: unknown,
): Promise<TResponse> {
  return getDevContainerRendererApi().invokeExtension(
    extensionId,
    command,
    payload,
  ) as Promise<TResponse>;
}

function getDevContainerRendererApi(): DevContainerRendererApi {
  const api = (window as unknown as { devContainer?: DevContainerRendererApi }).devContainer;
  if (!api) {
    throw new Error('Dev container renderer API is not available.');
  }
  return api;
}

export function createBlankPanel(): Component {
  return defineComponent({
    name: 'DevContainerBlankPanel',
    props: {
      params: {
        type: null as unknown as PropType<unknown>,
        required: false,
        default: undefined,
      },
    },
    setup(props) {
      return () =>
        h('div', {
          'aria-label': normalizeBlankPanelParams(props.params).title,
          'style': {
            width: '100%',
            height: '100%',
            background: '#ffffff',
          },
        });
    },
  });
}

function normalizeBlankPanelParams(value: unknown) {
  const params = unwrapDockViewParams(value);
  return {
    title: readString(params, 'title') || '',
  };
}

function unwrapDockViewParams(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  const nestedParams = value.params;
  return isRecord(nestedParams) ? nestedParams : value;
}

function readString(value: Record<string, unknown>, key: string) {
  const result = value[key];
  return typeof result === 'string' ? result : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export { DevContainerIcon } from './workbench-icon.js';
export { UserBadge } from './user-badge.js';
