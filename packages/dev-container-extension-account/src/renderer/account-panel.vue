<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import {
  DevContainerIcon,
  UserBadge,
  invokeDevContainerExtension as invoke,
  type GameUser,
} from '@bsgames/dev-container-api';
import { listClientBindings } from '@bsgames/dev-container-api/client-controls';
const users = ref<GameUser[]>([]),
      query = ref(''),
      error = ref(''),
      busy = ref(false),
      showEditor = ref(false);
const name = ref(''),
      editingId = ref<string>();
const bindings = ref(listClientBindings());
const filteredUsers = computed(() =>
  users.value.filter((user) =>
    (user.name + ' ' + user.id).toLowerCase().includes(query.value.trim().toLowerCase()),
  ),
);

async function load() {
  try {
    users.value = await invoke<GameUser[]>('account', 'list');
  } catch (cause) {
    error.value = String(cause);
  }
}

function updateBindings() {
  bindings.value = listClientBindings();
}

function openEditor(user?: GameUser) {
  editingId.value = user?.id;
  name.value = user?.name ?? '';
  error.value = '';
  showEditor.value = true;
}

async function save() {
  busy.value = true;
  error.value = '';
  try {
    await invoke('account', editingId.value ? 'rename' : 'create', {
      id: editingId.value,
      name: name.value,
    });
    await load();
    showEditor.value = false;
    window.dispatchEvent(new Event('dev-container:users-changed'));
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}

async function copyId(user: GameUser) {
  try {
    await navigator.clipboard.writeText(user.id);
  } catch (cause) {
    error.value = '复制用户 ID 失败：' + String(cause);
  }
}

function usersChanged() {
  void load();
}

onMounted(() => {
  void load();
  window.addEventListener('dev-container:clients-changed', updateBindings);
  window.addEventListener('dev-container:users-changed', usersChanged);
});
onBeforeUnmount(() => {
  window.removeEventListener('dev-container:clients-changed', updateBindings);
  window.removeEventListener('dev-container:users-changed', usersChanged);
});
</script>
<template>
  <section class="account-panel">
    <div class="users-toolbar">
      <div class="compact-search">
        <DevContainerIcon name="search" /><input
          v-model="query"
          type="search"
          placeholder="搜索用户"
          aria-label="搜索用户"
        >
      </div><button
        class="dc-button primary"
        @click="openEditor()"
      >
        <DevContainerIcon name="plus" />新建用户
      </button>
    </div>
    <div
      v-if="error && !showEditor"
      class="inline-error"
      role="alert"
    >
      {{ error }}
    </div>
    <div class="users-table-frame">
      <table class="users-table">
        <colgroup>
          <col style="width: 28%"><col style="width: 50%"><col style="width: 16%"><col
            style="width: 6%"
          >
        </colgroup><thead>
          <tr><th>名称</th><th>用户 ID</th><th>客户端</th><th /></tr>
        </thead><tbody>
          <tr
            v-for="user in filteredUsers"
            :key="user.id"
            :data-user-id="user.id"
          >
            <td>
              <div class="user-identity">
                <UserBadge :user="user" /><span>{{ user.name }}</span>
              </div>
            </td>
            <td>
              <div class="user-id">
                <code>{{ user.id }}</code><button
                  class="tool-button"
                  :aria-label="'复制 ' + user.name + ' 的用户 ID'"
                  title="复制用户 ID"
                  @click="copyId(user)"
                >
                  <DevContainerIcon name="copy" />
                </button>
              </div>
            </td>
            <td>
              <span
                v-for="client in bindings.filter((binding) => binding.userId === user.id)"
                :key="client.id"
                class="client-chip"
                :title="client.id"
              >{{ client.label }}</span><span
                v-if="!bindings.some((binding) => binding.userId === user.id)"
                class="no-client"
              >—</span>
            </td>
            <td>
              <button
                class="tool-button"
                :aria-label="'编辑 ' + user.name"
                title="编辑用户"
                @click="openEditor(user)"
              >
                <DevContainerIcon name="edit" />
              </button>
            </td>
          </tr>
        </tbody>
      </table><div
        v-if="!filteredUsers.length"
        class="empty-state"
      >
        没有匹配的用户
      </div>
    </div>
    <v-dialog
      v-model="showEditor"
      max-width="360"
      :persistent="busy"
    >
      <form
        class="dc-dialog"
        @submit.prevent="save"
      >
        <header class="dc-dialog-header">
          <h2>{{ editingId ? '编辑用户' : '新建用户' }}</h2><button
            type="button"
            class="tool-button"
            aria-label="关闭"
            :disabled="busy"
            @click="showEditor = false"
          >
            <DevContainerIcon name="close" />
          </button>
        </header>
        <div class="user-editor-body">
          <label for="user-name">名称</label><input
            id="user-name"
            v-model="name"
            aria-label="用户名称"
            class="dc-input"
            required
            :disabled="busy"
            autocomplete="off"
          >
          <div
            v-if="error"
            class="inline-error"
            role="alert"
          >
            {{ error }}
          </div>
        </div><footer class="dc-dialog-footer">
          <button
            type="button"
            class="dc-button quiet"
            :disabled="busy"
            @click="showEditor = false"
          >
            取消
          </button><button
            type="submit"
            class="dc-button primary"
            :disabled="busy || !name.trim()"
          >
            {{ editingId ? '保存' : '创建' }}
          </button>
        </footer>
      </form>
    </v-dialog>
  </section>
</template>
<style scoped>
.account-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.users-toolbar {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.users-table-frame {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid #2a465f;
  border-radius: 7px;
  background: #0b1725;
}
.users-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  text-align: left;
}
.users-table th {
  height: 34px;
  padding: 0 15px;
  font-size: 10px;
  font-weight: 500;
  color: #779ebc;
  background: #101e2d;
  border-bottom: 1px solid #284258;
}
.users-table td {
  height: 46px;
  padding: 0 15px;
  border-bottom: 1px solid #1c3349;
  font-size: 12px;
}
.users-table tr:hover {
  background: #102239;
}
.user-identity {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.user-identity > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-id {
  display: flex;
  align-items: center;
  gap: 10px;
}
.user-id code {
  font-size: 11px;
  color: #739ab9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-id .tool-button {
  opacity: 0.5;
}
.users-table tr:hover .user-id .tool-button {
  opacity: 1;
}
.client-chip {
  display: inline-grid;
  place-items: center;
  height: 21px;
  min-width: 29px;
  border: 1px solid #2b4962;
  border-radius: 4px;
  color: #89b7d8;
  font:
    10px Consolas,
    monospace;
  margin-right: 6px;
}
.no-client {
  color: #4f718e;
}
.user-editor-body {
  padding: 18px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.user-editor-body label {
  font-size: 11px;
  color: #87afce;
}
</style>
