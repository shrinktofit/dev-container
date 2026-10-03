import { BrowserWindow, screen, type Rectangle, type Session } from 'electron';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import type { ConfigStore, DevContainerMainWindowState } from './config-store.js';

const defaultMainWindowBounds = {
  width: 1440,
  height: 900,
} as const;

const minimumMainWindowBounds = {
  width: 960,
  height: 640,
} as const;

export class WindowManager {
  createMainWindow(opts: {
    configStore: ConfigStore;
    session: Session;
  }) {
    const windowState = normalizeMainWindowState(opts.configStore.mainWindowState);
    const mainWindow = new BrowserWindow({
      ...getInitialBounds(windowState),
      minWidth: minimumMainWindowBounds.width,
      minHeight: minimumMainWindowBounds.height,
      icon: fileURLToPath(new URL('../../build-resources/dev-container-icon.png', import.meta.url)),
      title: 'Dev Container',
      backgroundColor: '#080f19',
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#0b1421',
        symbolColor: '#b4cde3',
        height: 42,
      },
      webPreferences: {
        session: opts.session,
        preload: fileURLToPath(new URL('../preload/index.mjs', import.meta.url)),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false,
        webviewTag: true,
      },
    });
    this._registerMainWindowStatePersistence(mainWindow, opts.configStore, windowState);
    if (windowState?.maximized) {
      mainWindow.maximize();
    }
    return mainWindow;
  }

  async loadMainWindow(window: BrowserWindow) {
    const { ELECTRON_RENDERER_URL } = process.env;
    if (ELECTRON_RENDERER_URL) {
      await window.loadURL(ELECTRON_RENDERER_URL);
    } else {
      await window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)));
    }
  }

  private _registerMainWindowStatePersistence(
    mainWindow: BrowserWindow,
    configStore: ConfigStore,
    restoredState: DevContainerMainWindowState | undefined,
  ) {
    let normalBounds = restoredState?.bounds ?? mainWindow.getBounds();
    let saveTimeout: NodeJS.Timeout | undefined;

    const createState = (): DevContainerMainWindowState => ({
      version: 1,
      bounds: normalBounds,
      maximized: mainWindow.isMaximized(),
    });

    const scheduleSave = () => {
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
      saveTimeout = setTimeout(() => {
        saveTimeout = undefined;
        configStore.setMainWindowState(createState()).catch((error) => {
          console.error('Failed to save dev-container main window state.', error);
        });
      }, 250);
    };

    const updateNormalBounds = () => {
      if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
        normalBounds = mainWindow.getBounds();
      }
      scheduleSave();
    };

    mainWindow.on('move', updateNormalBounds);
    mainWindow.on('resize', updateNormalBounds);
    mainWindow.on('maximize', scheduleSave);
    mainWindow.on('unmaximize', updateNormalBounds);
    mainWindow.on('close', () => {
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
      configStore.setMainWindowStateSync(createState());
    });
  }
}

function getInitialBounds(state: DevContainerMainWindowState | undefined) {
  return state?.bounds ?? defaultMainWindowBounds;
}

function normalizeMainWindowState(
  value: DevContainerMainWindowState | undefined,
): DevContainerMainWindowState | undefined {
  if (value?.version !== 1 || !isValidBounds(value.bounds)) {
    return undefined;
  }
  const bounds = {
    x: value.bounds.x,
    y: value.bounds.y,
    width: Math.max(value.bounds.width, minimumMainWindowBounds.width),
    height: Math.max(value.bounds.height, minimumMainWindowBounds.height),
  };
  if (!isBoundsVisible(bounds)) {
    return undefined;
  }
  return {
    version: 1,
    bounds,
    maximized: value.maximized === true,
  };
}

function isValidBounds(value: Rectangle) {
  return (
    Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0
  );
}

function isBoundsVisible(bounds: Rectangle) {
  return screen.getAllDisplays().some((display) => rectanglesIntersect(bounds, display.workArea));
}

function rectanglesIntersect(a: Rectangle, b: Rectangle) {
  return (
    a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
  );
}
