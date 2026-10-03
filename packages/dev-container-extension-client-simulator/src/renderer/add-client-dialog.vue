<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  DevContainerIcon,
  UserBadge,
  invokeDevContainerExtension as invoke,
  type GameConfig,
  type GameUser,
  type LaunchOverrides,
} from '@bsgames/dev-container-api';
import { addClient, getNextClientLabel } from './create-client.ts';
import LaunchForm from './launch-form.vue';

const props = defineProps<{
  modelValue: boolean;
  config?: GameConfig;
  users: readonly GameUser[];
}>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'created': [];
  'userCreated': [user: GameUser];
}>();
const userId = ref(''),
      name = ref(''),
      values = ref<LaunchOverrides>({});
const busy = ref(false),
      error = ref(''),
      showLaunch = ref(false);
const creatingUser = ref(false),
      newUserName = ref('');
const user = computed(() => props.users.find((candidate) => candidate.id === userId.value));
const hasLaunchFields = computed(
  () => props.config && Object.keys(props.config.launch.schema.properties).length > 0,
);
watch(
  () => props.modelValue,
  (open) => {
    if (!open) {
      return;
    }
    userId.value = props.users[0]?.id ?? '';
    name.value = 'Client ' + Number(getNextClientLabel());
    values.value = {};
    error.value = '';
    showLaunch.value = false;
    creatingUser.value = false;
    newUserName.value = '';
  },
);

function resetDefaults() {
  if (props.config) {
    values.value = {};
  }
  error.value = '';
}

async function createUser() {
  if (busy.value || !newUserName.value.trim()) {
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const created = await invoke<GameUser>('account', 'create', { name: newUserName.value.trim() });
    emit('userCreated', created);
    userId.value = created.id;
    creatingUser.value = false;
    newUserName.value = '';
    window.dispatchEvent(new Event('dev-container:users-changed'));
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}

async function create() {
  if (busy.value || creatingUser.value || !user.value || !name.value.trim() || !props.config) {
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    try {
      await invoke('client-simulator', 'validate-launch', { values: { ...values.value } });
    } catch (cause) {
      showLaunch.value = true;
      throw cause;
    }
    addClient(user.value, name.value.trim(), { ...values.value });
    emit('created');
    emit('update:modelValue', false);
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <v-dialog
    :model-value="modelValue"
    max-width="680"
    scrollable
    :persistent="busy"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form
      class="dc-dialog create-client-dialog"
      novalidate
      @submit.prevent="create"
    >
      <header class="dc-dialog-header">
        <h2>添加客户端</h2>
        <button
          class="tool-button"
          type="button"
          aria-label="关闭添加客户端"
          :disabled="busy"
          @click="emit('update:modelValue', false)"
        >
          <DevContainerIcon name="close" />
        </button>
      </header>
      <div class="create-client-content">
        <fieldset :disabled="busy">
          <div class="client-fields">
            <label>客户端名称<input
              v-model="name"
              class="dc-input"
              aria-label="客户端名称"
              autocomplete="off"
              required
            ></label>
            <label>绑定用户<span class="client-user-select">
              <UserBadge
                v-if="user"
                :user="user"
              />
              <select
                v-model="userId"
                class="dc-input"
                aria-label="绑定用户"
              >
                <option
                  v-for="candidate in users"
                  :key="candidate.id"
                  :value="candidate.id"
                >
                  {{ candidate.name }}
                </option>
              </select>
              <button
                class="tool-button new-user-button"
                type="button"
                aria-label="新建用户"
                title="新建用户"
                :disabled="creatingUser"
                @click="
                  creatingUser = true;
                  error = '';
                "
              >
                <DevContainerIcon name="plus" />
              </button> </span></label>
          </div>
          <div
            v-if="creatingUser"
            class="new-user-fields"
          >
            <label>新用户名称<input
              v-model="newUserName"
              class="dc-input"
              aria-label="用户名称"
              autocomplete="off"
              @keydown.enter.prevent="createUser"
            ></label>
            <button
              class="dc-button quiet"
              type="button"
              :disabled="!newUserName.trim()"
              @click="createUser"
            >
              {{ busy ? '正在创建' : '创建用户' }}
            </button>
            <button
              class="tool-button"
              type="button"
              aria-label="取消新建用户"
              title="取消"
              @click="
                creatingUser = false;
                newUserName = '';
                error = '';
              "
            >
              <DevContainerIcon name="close" />
            </button>
          </div>
          <div
            v-if="hasLaunchFields && config"
            class="launch-section"
          >
            <button
              class="launch-disclosure"
              type="button"
              :aria-expanded="showLaunch"
              aria-controls="create-client-launch"
              @click="showLaunch = !showLaunch"
            >
              <span>启动参数</span><DevContainerIcon
                name="chevron"
                :class="{ expanded: showLaunch }"
              />
            </button>
            <div
              v-show="showLaunch"
              id="create-client-launch"
            >
              <LaunchForm
                :schema="config.launch.schema"
                :values="values"
                @change="
                  values = $event;
                  error = '';
                "
              />
            </div>
          </div>
        </fieldset>
        <div
          v-if="error"
          role="alert"
          class="inline-error"
        >
          {{ error }}
        </div>
      </div>
      <footer class="dc-dialog-footer">
        <button
          v-if="hasLaunchFields && showLaunch"
          class="dc-button quiet reset-defaults"
          type="button"
          :disabled="busy"
          @click="resetDefaults"
        >
          恢复默认
        </button>
        <button
          class="dc-button quiet"
          type="button"
          :disabled="busy"
          @click="emit('update:modelValue', false)"
        >
          取消
        </button>
        <button
          class="dc-button primary"
          type="submit"
          :disabled="busy || creatingUser || !user || !name.trim() || !config"
        >
          {{ busy && !creatingUser ? '正在添加' : '添加' }}
        </button>
      </footer>
    </form>
  </v-dialog>
</template>
<style scoped>
.create-client-dialog {
  display: flex;
  flex-direction: column;
  max-height: 85vh;
}
.create-client-content {
  padding: 16px;
  overflow: auto;
  min-height: 0;
}
.create-client-content fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.client-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
.client-fields label {
  display: grid;
  gap: 8px;
  min-width: 0;
  font-size: 11px;
  color: #bdd8ed;
}
.client-fields .dc-input {
  width: 100%;
  min-width: 0;
  height: 32px;
}
.client-user-select {
  display: flex;
  align-items: center;
  gap: 8px;
}
.launch-section {
  margin-top: 18px;
  border-top: 1px solid #263e54;
}
.launch-disclosure {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  color: #87afce;
  font-size: 11px;
}
.launch-disclosure .dc-icon {
  width: 14px;
  height: 14px;
  transition: transform 0.15s;
}
.launch-disclosure .dc-icon.expanded {
  transform: rotate(180deg);
}
.new-user-button {
  width: 32px;
  height: 32px;
  border: 1px solid #34546f;
}
.new-user-fields {
  display: flex;
  align-items: end;
  gap: 8px;
  margin-top: 12px;
}
.new-user-fields label {
  display: grid;
  gap: 8px;
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: #bdd8ed;
}
.new-user-fields > button {
  height: 32px;
}
.create-client-content .inline-error {
  margin-top: 12px;
}
.reset-defaults {
  margin-right: auto;
}
@media (max-width: 600px) {
  .client-fields {
    grid-template-columns: 1fr;
    gap: 12px;
  }
}
</style>
