<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { DockviewVue as DockViewVue } from 'dockview-vue';
import { themeDark, type DockviewReadyEvent as DockViewReadyEvent } from 'dockview-core';
import { devContainerRendererExtensions } from '../../extensions/renderer-extensions.js';
import { listClientBindings, stopUserClients } from '@bsgames/dev-container-api/client-controls';
import { devContainerApi } from '../renderer-api.js';
import {
  addDevContainerLayoutCommandListener,
  type DevContainerLayoutCommand,
} from '@bsgames/dev-container-api/layout-commands';
import type {
  DevContainerPanelOptions,
  DevContainerRendererReadyContext,
} from '@bsgames/dev-container-api';
import type { DevContainerRendererLaunchOptions } from '../../shared/ipc-contract.js';

let dockViewApi: DockViewReadyEvent['api'] | undefined;
let layoutChangeDisposable: { dispose(): void } | undefined;
let layoutCommandDisposable: { dispose(): void } | undefined;
let saveLayoutTimeoutId: number | undefined;
let saveLayoutEnabled = true;
let restoredLayout = false;
const panelCount = ref(0);

const layoutDirtyEventName = 'dev-container-layout-dirty';
const defaultPanelContributions = devContainerRendererExtensions
  .flatMap((extension) => extension.defaultPanels ?? [])
  .sort((a, b) => a.order - b.order);
const registeredComponentNames = new Set(
  devContainerRendererExtensions.flatMap((extension) => [
    ...Object.keys(extension.panels),
    ...Object.keys(extension.tabComponents ?? {}),
  ]),
);

async function onReady(event: DockViewReadyEvent) {
  dockViewApi = event.api;
  const launchOptions = await devContainerApi.getLaunchOptions();
  saveLayoutEnabled = launchOptions.saveLayout;
  await initializeLayout(dockViewApi, launchOptions);

  layoutChangeDisposable = dockViewApi.onDidLayoutChange(() => {
    updateGroupHeaders();
    scheduleSaveLayout();
  });

  await runAfterLayoutReadyHooks(dockViewApi);
  updateGroupHeaders();
}

async function initializeLayout(
  api: DockViewReadyEvent['api'],
  launchOptions: DevContainerRendererLaunchOptions,
) {
  switch (launchOptions.layoutSource) {
  case 'empty':
    return;

  case 'default':
    addDefaultPanels(api);
    return;

  case 'saved':
    await restoreSavedLayoutOrDefault(api);
    return;
  }
}

async function restoreSavedLayoutOrDefault(api: DockViewReadyEvent['api']) {
  const savedLayoutState = await devContainerApi.loadLayoutState();
  if (savedLayoutState?.version === 1) {
    const dockViewLayout = applyMigrateLayoutHooks(readSavedDockViewLayout(savedLayoutState));
    if (layoutUsesRegisteredComponents(dockViewLayout)) {
      try {
        api.fromJSON(dockViewLayout as never);
        restoredLayout = true;
        for (const id of ['account']) {
          const panel = api.getPanel(id);
          if (panel) {
            api.removePanel(panel);
          }
        }
        if (!hasPanels(api)) {
          addDefaultPanels(api);
        }
      } catch (error) {
        console.warn('Failed to restore dev-container layout, reset to defaults.', error);
        addDefaultPanels(api);
      }
    } else {
      addDefaultPanels(api);
    }
  } else {
    addDefaultPanels(api);
  }
}

async function runAfterLayoutReadyHooks(api: DockViewReadyEvent['api'], useDefaults = false) {
  const launchOptions = await devContainerApi.getLaunchOptions();
  const ctx: DevContainerRendererReadyContext = {
    layoutSource: useDefaults ? 'default' : launchOptions.layoutSource,
    restoredLayout,
    layout: {
      addPanel(panel) {
        addPanel(api, panel);
      },
      hasPanels() {
        return hasPanels(api);
      },
      removePanel,
      resetLayout,
    },
  };
  for (const extension of devContainerRendererExtensions) {
    try {
      await extension.afterLayoutReady?.(ctx);
    } catch (error) {
      console.error(`Failed to run dev-container afterLayoutReady hook: ${extension.id}`, error);
    }
  }
}

function addPanel(api: DockViewReadyEvent['api'], panel: DevContainerPanelOptions) {
  const existing = api.getPanel(panel.id);
  if (existing) {
    existing.api.setActive();
    return;
  }
  api.addPanel(panel);
  scheduleSaveLayout();
}

function addDefaultPanels(api: DockViewReadyEvent['api']) {
  for (const contribution of defaultPanelContributions) {
    api.addPanel(contribution.panel);
  }
}

function resetLayout() {
  if (!dockViewApi) {
    return;
  }
  rebuildDefaultLayout().catch((error) =>
    console.error('Failed to reset dev-container layout.', error),
  );
}

async function rebuildDefaultLayout() {
  if (!dockViewApi) {
    return;
  }
  for (const userId of new Set(listClientBindings().map((client) => client.userId))) {
    await stopUserClients(userId);
  }
  restoredLayout = false;
  dockViewApi.clear();
  addDefaultPanels(dockViewApi);
  await runAfterLayoutReadyHooks(dockViewApi, true);
  updateGroupHeaders();
  scheduleSaveLayout();
}

function removePanel(panelId: string) {
  if (!dockViewApi || !panelId) {
    return;
  }
  const api = toDockViewApiWithPanelLookup(dockViewApi);
  const panel = findDockViewPanel(panelId);
  if (!panel) {
    return;
  }
  const panelApi = panel as {
    api?: {
      close?(): void;
    };
    close?(): void;
  };
  if (panelApi.api?.close) {
    panelApi.api.close();
  } else if (panelApi.close) {
    panelApi.close();
  } else {
    api.removePanel?.(panel);
  }
  scheduleSaveLayout();
}

function updatePanel(command: Extract<DevContainerLayoutCommand, { type: 'updatePanel' }>) {
  if (!dockViewApi || !command.panelId) {
    return;
  }
  const panel = findDockViewPanel(command.panelId);
  if (!panel) {
    return;
  }
  const panelApi = panel as {
    api?: {
      getParameters?(): Record<string, unknown>;
      setTitle?(title: string): void;
      updateParameters?(params: Record<string, unknown>): void;
    };
  };
  if (command.title !== undefined) {
    panelApi.api?.setTitle?.(command.title);
  }
  if (command.params) {
    panelApi.api?.updateParameters?.({
      ...(panelApi.api.getParameters?.() ?? {}),
      ...command.params,
    });
  }
  scheduleSaveLayout();
}

function findDockViewPanel(panelId: string): unknown {
  if (!dockViewApi) {
    return undefined;
  }
  const api = toDockViewApiWithPanelLookup(dockViewApi);
  return (
    api.getPanel?.(panelId) ?? dockViewApi.panels.find((candidate) => candidate.id === panelId)
  );
}

function toDockViewApiWithPanelLookup(api: DockViewReadyEvent['api']) {
  return api as unknown as {
    getPanel?(id: string): unknown;
    removePanel?(panel: unknown): void;
  };
}

function updateGroupHeaders() {
  panelCount.value = dockViewApi?.panels.length ?? 0;
  for (const group of dockViewApi?.groups ?? []) {
    const hidden = group.panels.length === 1;
    if (group.header.hidden !== hidden) {
      group.header.hidden = hidden;
    }
  }
}

function scheduleSaveLayout() {
  if (!dockViewApi || !saveLayoutEnabled) {
    return;
  }
  if (saveLayoutTimeoutId !== undefined) {
    window.clearTimeout(saveLayoutTimeoutId);
  }
  saveLayoutTimeoutId = window.setTimeout(() => {
    saveLayoutTimeoutId = undefined;
    if (!dockViewApi) {
      return;
    }
    devContainerApi
      .saveLayoutState({
        version: 1,
        dockView: applyBeforeSaveLayoutHooks(dockViewApi.toJSON()),
      })
      .catch((error) => {
        console.error('Failed to save dev-container layout.', error);
      });
  }, 250);
}

function applyMigrateLayoutHooks(value: unknown) {
  let result = value;
  for (const extension of devContainerRendererExtensions) {
    result = extension.migrateLayout?.(result) ?? result;
  }
  return result;
}

function applyBeforeSaveLayoutHooks(value: unknown) {
  let result = value;
  for (const extension of devContainerRendererExtensions) {
    result = extension.beforeSaveLayout?.(result) ?? result;
  }
  return result;
}

function readSavedDockViewLayout(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }
  return value.dockView ?? value.dockview;
}

function hasPanels(api: DockViewReadyEvent['api']) {
  return api.panels.length > 0;
}

function layoutUsesRegisteredComponents(value: unknown): boolean {
  let result = true;
  visitLayout(value, (key, nestedValue) => {
    if (
      (key === 'component' || key === 'contentComponent' || key === 'tabComponent')
      && typeof nestedValue === 'string'
      && !registeredComponentNames.has(nestedValue)
    ) {
      result = false;
    }
  });
  return result;
}

function visitLayout(value: unknown, callback: (key: string, value: unknown) => void) {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitLayout(item, callback);
    }
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    callback(key, nestedValue);
    visitLayout(nestedValue, callback);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function onLayoutDirty() {
  scheduleSaveLayout();
}

onMounted(() => {
  window.addEventListener(layoutDirtyEventName, onLayoutDirty);
  layoutCommandDisposable = addDevContainerLayoutCommandListener((command) => {
    switch (command.type) {
    case 'addPanel':
      if (dockViewApi) {
        addPanel(dockViewApi, command.panel);
      }
      break;

    case 'removePanel':
      removePanel(command.panelId);
      break;

    case 'updatePanel':
      updatePanel(command);
      break;

    case 'resetLayout':
      resetLayout();
      break;
    }
  });
});

onUnmounted(() => {
  window.removeEventListener(layoutDirtyEventName, onLayoutDirty);
  layoutCommandDisposable?.dispose();
  layoutChangeDisposable?.dispose();
  if (saveLayoutTimeoutId !== undefined) {
    window.clearTimeout(saveLayoutTimeoutId);
  }
});
</script>

<template>
  <div class="dock-layout">
    <div
      v-if="!panelCount"
      class="empty-preview"
    >
      从客户端菜单添加客户端
    </div>
    <DockViewVue
      class="dock-layout__view"
      :theme="{ ...themeDark, gap: 16 }"
      @ready="onReady"
    />
  </div>
</template>

<style scoped>
.dock-layout {
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
}

.empty-preview {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #668cac;
  font-size: 12px;
  pointer-events: none;
  z-index: 1;
}

.dock-layout__view {
  width: 100%;
  height: 100%;
}
</style>
