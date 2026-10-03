<script setup lang="ts">
import { computed, watch, ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import {
  DevContainerIcon,
  UserBadge,
  invokeDevContainerExtension as invoke,
  ClientViewHostMode,
  type ClientDescriptor,
  type GameConfig,
  type DevContainerPreference,
  type GameUser,
  type LaunchOverrides,
} from '@bsgames/dev-container-api';
import {
  dispatchDevContainerLayoutCommand as dispatch,
} from '@bsgames/dev-container-api/layout-commands';
import {
  listClientBindings,
  registerClientControls,
} from '@bsgames/dev-container-api/client-controls';
import LaunchForm from './launch-form.vue';
import { showClientProfilePicker } from './show-client-profile-picker.ts';
import { initializeClientAudio, getClientMuted, setClientMuted } from './client-audio.ts';
import { attachIframeTransport } from './iframe-transport.ts';
interface ClientState {
  clientId: string;
  userId: string;
  values: LaunchOverrides;
  muted: boolean;
  sizeMode?: string;
  label?: string;
  title?: string;
  width?: number;
  height?: number;
}
const props = defineProps<{
  params:
    | ClientState
    | {
      params: ClientState;
    };
}>();
const initial = 'params' in props.params ? props.params.params : props.params;
const clientId: string = initial.clientId;
const label = initial.label ?? String(listClientBindings().length + 1).padStart(2, '0');
const clientTitle = initial.title ?? 'Client ' + Number(label);
const viewportWidth = ref(initial.width ?? 1280),
      viewportHeight = ref(initial.height ?? 720);
const viewportError = ref(''),
      showViewport = ref(false);
const draftValues = ref<LaunchOverrides>({ ...initial.values });
const frameStyle = computed(() =>
  sizeMode.value === 'fixed'
    ? {
      width: viewportWidth.value + 'px',
      height: viewportHeight.value + 'px',
      aspectRatio: 'auto',
    }
    : undefined,
);
const userId = ref<string>(initial.userId),
      values = ref<LaunchOverrides>({
        ...initial.values,
      });
initializeClientAudio(clientId, initial.muted);
const muted = computed(() => getClientMuted(clientId)),
      sizeMode = ref(initial.sizeMode ?? 'adaptive'),
      showForm = ref(false),
      busy = ref(false),
      error = ref('');
const currentUser = computed(() => users.value.find((user) => user.id === userId.value));
const preference = ref<DevContainerPreference>();
const config = ref<GameConfig>(),
      users = ref<GameUser[]>([]),
      descriptor = ref<ClientDescriptor>();
const frame = ref<HTMLIFrameElement>();
interface Guest {
  setAudioMuted(value: boolean): void;
  openDevTools(): void;
}
const guest = ref<Guest>();
let detachFrame: (() => void) | undefined,
    unregister: (() => void) | undefined,
    disposed = false;

function persist() {
  dispatch({
    type: 'updatePanel',
    panelId: clientId,
    title: clientTitle,
    params: {
      clientId,
      label,
      width: viewportWidth.value,
      height: viewportHeight.value,
      userId: userId.value,
      values: {
        ...values.value,
      },
      muted: muted.value,
      sizeMode: sizeMode.value,
      title: clientTitle,
    },
  });
  window.dispatchEvent(new Event('dev-container:clients-changed'));
}

async function stop() {
  const current = descriptor.value;
  if (!current) {
    return;
  }
  descriptor.value = undefined;
  await nextTick();
  detachFrame?.();
  detachFrame = undefined;
  await invoke('client-simulator', 'release-client', {
    token: current.token,
  });
}

async function start() {
  if (disposed) {
    return;
  }
  const current = await invoke<ClientDescriptor>('client-simulator', 'register-client', {
    clientId,
    userId: userId.value,
    values: {
      ...values.value,
    },
  });
  if (current.viewHost === ClientViewHostMode.iframe) {
    try {
      detachFrame = await attachIframeTransport(current.token, () => frame.value);
    } catch (error) {
      await invoke('client-simulator', 'release-client', { token: current.token });
      throw error;
    }
  }
  descriptor.value = current;
  if (current.viewHost === ClientViewHostMode.iframe) {
    applyMute();
  }
  persist();
}

async function act(action: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function restart() {
  await invoke('client-simulator', 'validate-launch', {
    values: {
      ...values.value,
    },
  });
  await stop();
  await start();
}

async function applyConfiguration() {
  await act(async () => {
    await invoke('client-simulator', 'validate-launch', { values: { ...draftValues.value } });
    await stop();
    values.value = { ...draftValues.value };
    await start();
    showForm.value = false;
  });
}

function resetDefaults() {
  if (config.value) {
    draftValues.value = {};
  }
}

function changeSize(mode: string) {
  viewportError.value = '';
  if (
    mode === 'fixed'
    && ![viewportWidth.value, viewportHeight.value].every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 16384,
    )
  ) {
    viewportError.value = '宽高必须是 1–16384 的整数';
    return;
  }
  sizeMode.value = mode;
  persist();
  showViewport.value = false;
}

function configure() {
  draftValues.value = { ...values.value };
  showForm.value = true;
}

async function closeClient() {
  await act(async () => {
    await stop();
    dispatch({ type: 'removePanel', panelId: clientId });
  });
}

function applyMute() {
  if (preference.value?.viewHost === ClientViewHostMode.webview) {
    guest.value?.setAudioMuted(muted.value);
  } else {
    void invoke('client-simulator', 'mute', {
      muted: muted.value,
    });
  }
  persist();
}

function tools() {
  if (descriptor.value?.viewHost === ClientViewHostMode.webview) {
    guest.value?.openDevTools();
  } else {
    void invoke('client-simulator', 'devtools');
  }
}

async function switchUser() {
  await refreshUsers();
  const picked = await showClientProfilePicker(users.value, {
    title: '切换用户',
    currentProfileId: userId.value,
  });
  if (!picked) {
    return;
  }
  const next
    = picked.type === 'create'
      ? await invoke<GameUser>('account', 'create', {
        name: picked.name,
      })
      : users.value.find((user) => user.id === picked.profileId);
  if (!next) {
    return;
  }
  window.dispatchEvent(new Event('dev-container:users-changed'));
  await act(async () => {
    await stop();
    userId.value = next.id;
    await start();
  });
}

function editValues(next: LaunchOverrides) {
  draftValues.value = next;
}

async function refreshUsers() {
  users.value = await invoke<GameUser[]>('account', 'list');
  persist();
}

function usersChanged() {
  refreshUsers().catch((e) => (error.value = String(e)));
}

watch(muted, applyMute);
onMounted(() => {
  window.addEventListener('dev-container:users-changed', usersChanged);
  void act(async () => {
    config.value = await invoke<GameConfig>('client-simulator', 'config');
    preference.value = await invoke<DevContainerPreference>('client-simulator', 'preference');
    users.value = await invoke<GameUser[]>('account', 'list');
    unregister = registerClientControls(
      clientId,
      {
        userId: () => userId.value,
        stop,
        restart: start,
      },
      label,
    );
    await start();
  });
});
onBeforeUnmount(() => {
  disposed = true;
  window.removeEventListener('dev-container:users-changed', usersChanged);
  unregister?.();
  stop().catch((e) => console.error('Client write completion failed', e));
});
</script>

<template>
  <section
    class="client-view-panel client-panel"
    :data-client-id="clientId"
  >
    <header class="client-view-panel__toolbar">
      <button
        class="client-identity"
        aria-label="切换用户"
        :disabled="busy"
        @click="switchUser"
      >
        <UserBadge :user="currentUser" />
        <span :title="currentUser?.name">{{ clientTitle }}</span>
        <DevContainerIcon name="chevron" />
        <code>{{ label }}</code>
      </button>
      <div class="client-tools">
        <button
          class="tool-button"
          aria-label="刷新"
          title="刷新"
          :disabled="busy"
          @click="act(restart)"
        >
          <DevContainerIcon name="refresh" />
        </button>
        <button
          class="tool-button"
          :aria-label="muted ? '取消静音' : '静音'"
          :title="muted ? '取消静音' : '静音'"
          @click="setClientMuted(clientId, !muted)"
        >
          <DevContainerIcon :name="muted ? 'muted' : 'sound'" />
        </button>
        <v-menu
          v-model="showViewport"
          :close-on-content-click="false"
        >
          <template #activator="{ props: activatorProps }">
            <button
              v-bind="activatorProps"
              class="tool-button"
              aria-label="视口适配"
              title="视口适配"
            >
              <DevContainerIcon name="viewport" />
            </button>
          </template><div class="viewport-menu desktop-dropdown">
            <button
              class="menu-item"
              :class="{ selected: sizeMode === 'adaptive' }"
              @click="changeSize('adaptive')"
            >
              自适应
            </button><button
              class="menu-item"
              :class="{ selected: sizeMode === 'fitWidth' }"
              @click="changeSize('fitWidth')"
            >
              适应宽度
            </button><button
              class="menu-item"
              :class="{ selected: sizeMode === 'fitHeight' }"
              @click="changeSize('fitHeight')"
            >
              适应高度
            </button><div class="menu-separator" /><form
              class="viewport-dimensions"
              @submit.prevent="changeSize('fixed')"
            >
              <label>宽<input
                v-model.number="viewportWidth"
                type="number"
                min="1"
                max="16384"
                required
                class="dc-input"
                aria-label="视口宽度"
              ></label><label>高<input
                v-model.number="viewportHeight"
                type="number"
                min="1"
                max="16384"
                required
                class="dc-input"
                aria-label="视口高度"
              ></label><button
                class="dc-button quiet"
                type="submit"
              >
                应用
              </button>
            </form><div
              v-if="viewportError"
              class="inline-error"
              role="alert"
            >
              {{ viewportError }}
            </div>
          </div>
        </v-menu>
        <button
          class="tool-button"
          aria-label="打开启动配置"
          title="启动设置"
          @click="configure"
        >
          <DevContainerIcon name="settings" />
        </button>
        <button
          class="client-devtools"
          :disabled="!descriptor"
          @click="tools"
        >
          <DevContainerIcon name="code" />DevTools
        </button>
        <div class="client-close">
          <button
            class="tool-button"
            aria-label="关闭客户端"
            title="关闭客户端"
            :disabled="busy"
            @click="closeClient"
          >
            <DevContainerIcon name="close" />
          </button>
        </div>
      </div>
    </header>
    <div
      v-if="error && descriptor"
      role="alert"
      class="inline-error"
    >
      {{ error
      }}<button
        class="dc-button quiet"
        :disabled="busy"
        @click="act(restart)"
      >
        重试
      </button>
    </div>
    <div class="client-view-panel__viewport">
      <div
        class="client-view-panel__frame"
        :class="'client-view-panel__frame--' + sizeMode"
        :style="frameStyle"
      >
        <webview
          v-if="descriptor?.viewHost === ClientViewHostMode.webview"
          ref="guest"
          :key="descriptor.token"
          class="client-view-panel__host"
          :src="descriptor.url"
          @dom-ready="applyMute"
          @did-fail-load="error = String($event.errorDescription) + ' (' + $event.errorCode + ')'"
        />
        <iframe
          v-else-if="descriptor"
          ref="frame"
          :key="descriptor.token"
          class="client-view-panel__host"
          :src="descriptor.frameUrl"
          allow="autoplay; fullscreen"
        />
        <div
          v-else
          class="client-view-panel__diagnostic"
        >
          <div class="diagnostic-card">
            <h3>{{ busy ? '正在加载预览' : '预览未启动' }}</h3>
            <code>{{ config?.client.dir }} / {{ config?.client.subpath }}</code>
            <div
              v-if="error"
              role="alert"
            >
              {{ error }}
            </div><button
              class="dc-button quiet"
              :disabled="busy"
              @click="act(restart)"
            >
              重试
            </button>
          </div>
        </div>
      </div>
    </div>
    <v-dialog
      v-model="showForm"
      max-width="680"
      scrollable
      :persistent="busy"
    >
      <div class="dc-dialog launch-config-card">
        <header class="dc-dialog-header">
          <h2>启动设置 · {{ currentUser?.name }}</h2><button
            class="tool-button"
            aria-label="关闭启动设置"
            :disabled="busy"
            @click="showForm = false"
          >
            <DevContainerIcon name="close" />
          </button>
        </header><div class="launch-config-content">
          <LaunchForm
            v-if="config"
            :schema="config.launch.schema"
            :values="draftValues"
            @change="editValues"
          /><div
            v-if="error"
            role="alert"
            class="inline-error"
          >
            {{ error }}
          </div>
        </div><footer class="dc-dialog-footer">
          <button
            class="dc-button quiet reset-launch"
            :disabled="busy"
            @click="resetDefaults"
          >
            恢复默认
          </button><button
            class="dc-button quiet"
            :disabled="busy"
            @click="showForm = false"
          >
            取消
          </button><button
            class="dc-button primary"
            :disabled="busy"
            @click="applyConfiguration"
          >
            保存并重启
          </button>
        </footer>
      </div>
    </v-dialog>
  </section>
</template>
<style scoped>
.client-view-panel {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  background: #080f19;
}
.client-view-panel__toolbar {
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid #29445f;
  background: #101d2c;
}
.client-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
  color: #c7e5fb;
}
.client-identity > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 150px;
}
.client-identity .dc-icon {
  width: 13px;
  height: 13px;
}
.client-identity code {
  font-size: 10px;
  color: #7297b7;
  margin-left: 4px;
}
.client-tools {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}
.client-devtools {
  height: 27px;
  border: 1px solid #2b4b68;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 5px;
  margin-left: 6px;
  padding: 0 8px;
  color: #92b9d9;
  font-size: 10px;
}
.client-devtools .dc-icon {
  width: 14px;
  height: 14px;
}
.client-close {
  border-left: 1px solid #29445f;
  display: flex;
  margin-left: 18px;
  padding-left: 16px;
}
.client-close .tool-button:hover {
  background: #472431;
  color: #e9a5b4;
}
.client-view-panel__viewport {
  position: relative;
  display: flex;
  container-type: size;
  width: 100%;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  overflow: auto;
  background: #080f19;
}
.client-view-panel__frame {
  aspect-ratio: 16/9;
  flex: 0 0 auto;
  background: #091522;
}
.client-view-panel__frame--adaptive {
  width: min(100%, calc(100cqh * 16 / 9));
  max-width: 100%;
  max-height: 100%;
}
.client-view-panel__frame--fitWidth {
  width: 100%;
}
.client-view-panel__frame--fitHeight {
  height: 100%;
}
.client-view-panel__host {
  display: flex;
  width: 100%;
  height: 100%;
  border: 0;
}
.client-view-panel__diagnostic {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  padding: 18px;
  background: #091522;
}
.diagnostic-card {
  display: flex;
  flex-direction: column;
  width: min(100%, 420px);
  gap: 10px;
  padding: 16px;
  border: 1px solid #744758;
  border-radius: 8px;
  background: #101d2c;
  color: #a8bed4;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.diagnostic-card h3 {
  font-size: 15px;
  font-weight: 600;
  color: #ecc2cd;
}
.diagnostic-card code {
  font-size: 11px;
  color: #87afce;
}
.diagnostic-card > div {
  white-space: pre-wrap;
}
.launch-config-card {
  display: flex;
  flex-direction: column;
  max-height: 85vh;
}
.launch-config-content {
  padding: 16px;
  overflow: auto;
  flex: 1;
  min-height: 0;
}
.launch-config-content > .inline-error {
  margin-top: 12px;
}
.reset-launch {
  margin-right: auto;
}
.viewport-menu {
  width: 260px;
}
.viewport-menu .selected {
  background: #152e48;
  color: #a4ddff;
}
.viewport-dimensions {
  display: flex;
  align-items: flex-end;
  gap: 7px;
  padding: 8px;
}
.viewport-dimensions label {
  display: grid;
  gap: 5px;
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: #87afce;
}
.viewport-dimensions input {
  height: 28px;
}
.viewport-dimensions > .dc-button {
  padding: 0 8px;
}
.client-panel > .inline-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 0;
}
</style>
