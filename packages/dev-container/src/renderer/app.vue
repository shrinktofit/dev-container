<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import {
  DevContainerIcon,
  invokeDevContainerExtension as invoke,
  type GameConfig,
  type GameUser,
} from '@bsgames/dev-container-api';
import { AddClientDialog } from '@bsgames/dev-container-extension-client-simulator/renderer';
import {
  dispatchDevContainerLayoutCommand as dispatch,
} from '@bsgames/dev-container-api/layout-commands';
import { devContainerApi } from './renderer-api.js';
import PreferencePanel from './components/preference-panel.vue';
import DockLayout from './layout/dock-layout.vue';
import productIconUrl from '../../build-resources/dev-container-icon.svg?url';
import { devContainerRendererExtensions } from '../extensions/renderer-extensions.js';
enum Page {
  clients = 'clients',
  users = 'users',
  preference = 'preference',
}
const clientMenu = ref(false),
      showAddClient = ref(false);
const page = ref(Page.clients),
      diagnostic = ref('');
const config = ref<GameConfig>(),
      users = ref<GameUser[]>([]);
const host = ref<{
  targetDirectory: string;
  workspaceLabel: string;
  devtoolsHttpOrigin?: string;
}>();
const accountComponent = devContainerRendererExtensions.find(
  (extension) => extension.id === 'account',
)!.panels.account;
let unsubscribe: (() => void) | undefined;

async function loadUsers() {
  try {
    users.value = await invoke<GameUser[]>('account', 'list');
  } catch (error) {
    diagnostic.value = String(error);
  }
}

function usersChanged() {
  void loadUsers();
}

onMounted(async () => {
  unsubscribe = devContainerApi.onDiagnostic((message) => (diagnostic.value = message));
  window.addEventListener('dev-container:users-changed', usersChanged);
  try {
    [config.value, host.value] = await Promise.all([
      invoke<GameConfig>('client-simulator', 'config'),
      invoke<{
        targetDirectory: string;
        workspaceLabel: string;
        devtoolsHttpOrigin?: string;
      }>('client-simulator', 'host-info'),
    ]);
    await loadUsers();
  } catch (error) {
    diagnostic.value = String(error);
  }
});
onBeforeUnmount(() => {
  unsubscribe?.();
  window.removeEventListener('dev-container:users-changed', usersChanged);
});
</script>
<template>
  <v-app>
    <header class="app-menu-bar">
      <v-menu>
        <template #activator="{ props }">
          <button
            v-bind="props"
            class="menu-brand"
            aria-label="Dev Container 菜单"
            title="Dev Container"
          >
            <img
              class="brand-mark"
              :src="productIconUrl"
              alt=""
              aria-hidden="true"
            >
          </button>
        </template>
        <div class="desktop-dropdown">
          <button
            class="menu-item"
            @click="page = Page.preference"
          >
            <DevContainerIcon name="settings" />偏好设置
          </button>
        </div>
      </v-menu>
      <nav
        class="desktop-menus"
        aria-label="主菜单"
      >
        <v-menu
          v-model="clientMenu"
          :close-on-content-click="false"
        >
          <template #activator="{ props }">
            <button
              v-bind="props"
              class="menu-trigger"
            >
              客户端
            </button>
          </template>
          <div class="desktop-dropdown">
            <button
              class="menu-item"
              :disabled="!config || !users.length"
              @click="
                clientMenu = false;
                showAddClient = true;
              "
            >
              <DevContainerIcon name="plus" /><span>添加客户端</span>
            </button>
          </div>
        </v-menu>
        <v-menu>
          <template #activator="{ props }">
            <button
              v-bind="props"
              class="menu-trigger"
            >
              视图
            </button>
          </template>
          <div class="desktop-dropdown">
            <button
              class="menu-item"
              @click="page = Page.clients"
            >
              <DevContainerIcon name="clients" />客户端
            </button>
            <button
              class="menu-item"
              @click="page = Page.users"
            >
              <DevContainerIcon name="users" />用户管理
            </button>

            <div class="menu-separator" />
            <button
              class="menu-item"
              @click="dispatch({ type: 'resetLayout' })"
            >
              恢复默认布局
            </button>
          </div>
        </v-menu>
      </nav>
      <div
        class="project-context"
        :title="host?.targetDirectory"
      >
        <span>{{ config?.game.title }}</span>
        <span class="project-workspace">工作区 <code>{{ host?.workspaceLabel }}</code>
        </span>
      </div>
      <div
        class="remote-debug"
        :title="
          host?.devtoolsHttpOrigin
            ? '外部调试工具连接地址：' + host.devtoolsHttpOrigin
            : '远程调试未开启；客户端 DevTools 仍可手动打开'
        "
      >
        远程调试 <span>{{ host?.devtoolsHttpOrigin ? '开启' : '关闭' }}</span>
      </div>
    </header>
    <div class="workbench">
      <nav
        class="icon-rail"
        aria-label="工作台"
      >
        <button
          class="rail-button"
          :class="{ active: page === Page.clients }"
          aria-label="客户端"
          title="客户端"
          @click="page = Page.clients"
        >
          <DevContainerIcon name="clients" />
        </button>
        <button
          class="rail-button"
          :class="{ active: page === Page.users }"
          aria-label="用户管理"
          title="用户管理"
          @click="page = Page.users"
        >
          <DevContainerIcon name="users" />
        </button>
      </nav>
      <main class="workbench-content">
        <DockLayout v-show="page === Page.clients" />
        <component
          :is="accountComponent"
          v-if="page === Page.users"
        />

        <PreferencePanel v-show="page === Page.preference" />
      </main>
    </div>
    <AddClientDialog
      v-model="showAddClient"
      :config="config"
      :users="users"
      @user-created="users.push($event)"
      @created="page = Page.clients"
    />
    <div
      v-if="diagnostic"
      role="alert"
      class="app-diagnostic"
    >
      <span>{{ diagnostic }}</span><button
        class="tool-button"
        aria-label="关闭诊断"
        @click="diagnostic = ''"
      >
        <DevContainerIcon name="close" />
      </button>
    </div>
  </v-app>
</template>
<style scoped>
.app-menu-bar {
  app-region: drag;
  padding-left: env(titlebar-area-x, 0px);
  padding-right: calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100%));
  height: 42px;
  flex-shrink: 0;
  background: #0b1421;
  border-bottom: 1px solid #22354a;
  display: flex;
  align-items: center;
  position: relative;
  z-index: 20;
}
.menu-brand {
  app-region: no-drag;
  height: 42px;
  width: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.brand-mark {
  display: block;
  width: 28px;
  height: 28px;
}
.desktop-menus {
  app-region: no-drag;
  display: flex;
  gap: 2px;
  padding-left: 6px;
}
.menu-trigger {
  height: 30px;
  padding: 0 12px;
  border-radius: 4px;
  color: #b4cde3;
  font-size: 12px;
}
.menu-trigger:hover {
  background: #1a344e;
}
.project-context {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: min(440px, 35vw);
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: #0e1825;
  border: 1px solid #263547;
  border-radius: 8px;
  font-size: 12px;
  color: #abc5da;
  white-space: nowrap;
  overflow: hidden;
}
.project-workspace {
  font-size: 11px;
  color: #68849f;
}
.project-workspace code {
  color: #8eacc5;
  margin-left: 3px;
}
.remote-debug {
  app-region: no-drag;
  margin-left: auto;
  padding: 0 22px;
  color: #6e91b2;
  font-size: 10px;
}
.remote-debug span {
  margin-left: 7px;
  color: #9cbdd8;
}
.workbench {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.icon-rail {
  width: 52px;
  flex-shrink: 0;
  padding: 13px 7px;
  background: #060c14;
  border-right: 1px solid #22354a;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rail-button {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  color: #8ea7c1;
}
.rail-button.active {
  background: #152e48;
  color: #a5dcff;
  box-shadow: inset 2px 0 #a4ddff;
}
.rail-button:hover {
  background: #102135;
}
.workbench-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 18px;
  overflow: hidden;
}
.app-diagnostic {
  position: fixed;
  bottom: 12px;
  right: 12px;
  z-index: 2500;
  display: flex;
  gap: 12px;
  max-width: calc(100% - 76px);
  max-height: 35vh;
  overflow: auto;
  padding: 12px;
  border: 1px solid #744758;
  background: #291a26;
  color: #ecc2cd;
  white-space: pre-wrap;
  font-size: 12px;
  border-radius: 6px;
}
.app-diagnostic > span {
  flex: 1;
}
</style>
