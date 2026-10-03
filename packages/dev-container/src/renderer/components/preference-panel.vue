<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  ClientViewHostMode,
  DevContainerIcon,
  HostLayoutSource,
  type DevContainerPreference,
} from '@bsgames/dev-container-api';
import { devContainerApi } from '../renderer-api.js';

const preference = ref<DevContainerPreference>(),
      original = ref<DevContainerPreference>();
const busy = ref(true),
      error = ref(''),
      saved = ref(false);
const dirty = computed(
  () =>
    preference.value
    && original.value
    && (preference.value.viewHost !== original.value.viewHost
      || preference.value.layout !== original.value.layout
      || preference.value.saveLayout !== original.value.saveLayout),
);
onMounted(async () => {
  try {
    const value = await devContainerApi.getPreference();
    original.value = value;
    preference.value = { ...value };
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
});

function discardChanges() {
  if (!original.value) {
    return;
  }
  preference.value = { ...original.value };
  error.value = '';
  saved.value = false;
}

async function save() {
  if (!preference.value || !dirty.value || busy.value) {
    return;
  }
  const value = { ...preference.value };
  busy.value = true;
  error.value = '';
  saved.value = false;
  try {
    await devContainerApi.savePreference(value);
    original.value = value;
    saved.value = true;
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section
    class="preference-panel"
    aria-label="偏好设置"
  >
    <form @submit.prevent="save">
      <div class="preference-toolbar">
        <span
          v-if="saved && !dirty"
          class="preference-status"
          role="status"
        >已保存，下次启动生效。</span>
        <span
          v-else
          class="preference-hint"
        >下次启动生效</span>
        <div class="preference-actions">
          <button
            class="dc-button quiet"
            type="button"
            :disabled="busy || !dirty"
            @click="discardChanges"
          >
            <DevContainerIcon name="undo" />放弃修改
          </button>
          <button
            class="dc-button primary"
            type="submit"
            :disabled="busy || !dirty"
          >
            {{ busy && preference ? '正在保存' : '保存' }}
          </button>
        </div>
      </div>
      <div
        v-if="error"
        role="alert"
        class="inline-error"
      >
        {{ error }}
      </div>
      <fieldset
        v-if="preference"
        class="preference-fields"
        :disabled="busy"
      >
        <label class="preference-row">
          <span>预览模式</span>
          <select
            v-model="preference.viewHost"
            class="dc-input"
            aria-label="预览模式"
          >
            <option :value="ClientViewHostMode.webview">Webview</option>
            <option :value="ClientViewHostMode.iframe">Iframe</option>
          </select>
        </label>
        <label class="preference-row">
          <span>启动布局</span>
          <select
            v-model="preference.layout"
            class="dc-input"
            aria-label="启动布局"
          >
            <option :value="HostLayoutSource.saved">恢复上次布局</option>
            <option :value="HostLayoutSource.default">默认布局</option>
            <option :value="HostLayoutSource.empty">空布局</option>
          </select>
        </label>
        <label class="preference-row">
          <span>保存布局</span>
          <span class="preference-checkbox">
            <input
              v-model="preference.saveLayout"
              type="checkbox"
              aria-label="保存布局"
            >
            布局和客户端状态
          </span>
        </label>
      </fieldset>
    </form>
  </section>
</template>
<style scoped>
.preference-panel {
  height: 100%;
  overflow: auto;
}
.preference-panel form {
  width: min(100%, 640px);
}
.preference-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  min-height: 28px;
}
.preference-hint,
.preference-status {
  font-size: 11px;
  color: #87afce;
}
.preference-status {
  color: #a4ddff;
}
.preference-actions {
  display: flex;
  gap: 8px;
}
.preference-fields {
  margin: 0;
  padding: 0;
  border: 1px solid #29445f;
  border-radius: 6px;
  overflow: hidden;
  background: #101d2c;
}
.preference-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  align-items: center;
  gap: 20px;
  padding: 14px 16px;
  border-bottom: 1px solid #263e54;
  font-size: 12px;
  color: #bdd8ed;
}
.preference-row:last-child {
  border-bottom: 0;
}
.preference-row .dc-input {
  max-width: 280px;
}
.preference-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #87afce;
}
.inline-error {
  margin-bottom: 14px;
}
@media (max-width: 600px) {
  .preference-row {
    grid-template-columns: 100px minmax(0, 1fr);
    gap: 12px;
  }
}
</style>
