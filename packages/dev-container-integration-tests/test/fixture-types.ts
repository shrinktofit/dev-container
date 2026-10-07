import type { DevContainerAccount } from '@bsgames/dev-container-sdk';
interface HostUser {
  id: string;
  name: string;
}
interface ClientDescriptor {
  clientId: string;
  user: HostUser;
  token: string;
  url: string;
  frameUrl: string;
  previewUrl: string;
  partition: string;
  sessionPath: string;
  viewHost: 'webview' | 'iframe';
}

export interface DebugSession {
  pid: number;
  remoteDebuggingPort: number | null;
  devtoolsHttpOrigin: string | null;
  clients: ClientDescriptor[];
}

export interface UserFile {
  users: HostUser[];
}

export interface WindowLayout {
  mainWindowState: { bounds: { width: number; height: number }; maximized: boolean };
  layoutState: {
    dockView: {
      panels: Record<string, {
        title: string;
        params: { muted: boolean; values: Record<string, string | number | boolean | null> };
      }>;
    };
  };
}

export interface NativeWindow {
  Handle: number;
  Title: string;
  Class: string;
  Minimized: boolean;
  Maximized: boolean;
  Text: string[];
}

declare global {
  interface Window {
    account: DevContainerAccount;
    __devContainer: { readonly account: DevContainerAccount };
    sdkReady: boolean;
    userBeforeLogin?: { id: string };
    sdkError?: string;
    importAvailable: boolean;
  }
  interface Navigator {
    readonly windowControlsOverlay: {
      readonly visible: boolean;
      getTitlebarAreaRect(): DOMRect;
    };
  }
}
