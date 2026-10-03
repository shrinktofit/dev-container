<script setup lang="ts">
import { computed } from 'vue';
import { getClientMuted, initializeClientAudio, setClientMuted } from './client-audio.ts';
import {
  dispatchDevContainerLayoutCommand as dispatch,
} from '@bsgames/dev-container-api/layout-commands';
interface TabState {
  clientId: string;
  muted: boolean;
  title?: string;
}
const props = defineProps<{
  api?: {
    title?: string;
    close?(): void;
  };
  params:
    | TabState
    | {
      params: TabState;
    };
}>();
const params = computed(() => ('params' in props.params ? props.params.params : props.params));
initializeClientAudio(params.value.clientId, params.value.muted);
const title = computed(() => params.value.title ?? props.api?.title ?? 'Client');
const muted = computed(() => getClientMuted(params.value.clientId));
const muteLabel = computed(() => (muted.value ? '取消静音' : '静音'));

function toggleMuted() {
  setClientMuted(params.value.clientId, !muted.value);
}

function closePanel() {
  if (props.api?.close) {
    props.api.close();
  } else {
    dispatch({
      type: 'removePanel',
      panelId: params.value.clientId,
    });
  }
}
</script>
<template>
  <div class="client-tab">
    <span class="client-tab__title">{{ title }}</span>
    <button
      class="client-tab__button"
      :aria-label="muteLabel"
      :title="muteLabel"
      type="button"
      @click.prevent.stop="toggleMuted"
      @mousedown.stop
      @pointerdown.stop
    >
      <svg
        v-if="muted"
        aria-hidden="true"
        class="client-tab__icon"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        viewBox="0 0 24 24"
      >
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        <path d="m22 9-6 6" />
        <path d="m16 9 6 6" />
      </svg>
      <svg
        v-else
        aria-hidden="true"
        class="client-tab__icon"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        viewBox="0 0 24 24"
      >
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        <path d="M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
    </button>
    <button
      class="client-tab__button client-tab__button--close"
      aria-label="关闭"
      title="关闭"
      type="button"
      @click.prevent.stop="closePanel"
      @mousedown.stop
      @pointerdown.stop
    >
      <svg
        aria-hidden="true"
        class="client-tab__icon"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        viewBox="0 0 24 24"
      >
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.client-tab {
  display: flex;
  min-width: 0;
  height: 100%;
  align-items: center;
  gap: 4px;
}

.client-tab__title {
  min-width: 0;
  overflow: hidden;
  flex: 1 1 auto;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.client-tab__button {
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #92b9d9;
  cursor: pointer;
}

.client-tab__button:hover {
  background: #1d3a55;
  color: #bfe7ff;
}

.client-tab__button--close:hover {
  background: #39232e;
  color: #ecc2cd;
}

.client-tab__icon {
  width: 14px;
  height: 14px;
}
</style>
