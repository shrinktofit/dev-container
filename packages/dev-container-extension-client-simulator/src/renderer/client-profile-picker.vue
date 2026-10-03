<script setup lang="ts">
import { computed, ref } from 'vue';
import { UserBadge } from '@bsgames/dev-container-api';
import type { ClientProfile, ClientProfileId } from '../shared/client-profile.ts';

const props = withDefaults(defineProps<{
  title?: string;
  profiles: readonly ClientProfile[];
  currentProfileId?: ClientProfileId;
}>(), {
  title: '添加客户端',
  currentProfileId: undefined,
});

const emit = defineEmits<{
  cancel: [];
  create: [name: string];
  select: [profileId: ClientProfileId];
}>();

const newProfileName = ref(`Client ${props.profiles.length + 1}`);
const canCreateProfile = computed(() => newProfileName.value.trim().length > 0);

function createProfile() {
  const name = newProfileName.value.trim();
  if (!name) {
    return;
  }
  emit('create', name);
}

function summarizeWebDevId(profile: ClientProfile) {
  if (!profile.id) {
    return '未分配 web-dev-id';
  }
  return profile.id;
}

function isCurrentProfile(profile: ClientProfile) {
  return profile.id === props.currentProfileId;
}
</script>

<template>
  <div
    class="client-profile-picker"
    @mousedown.self="emit('cancel')"
  >
    <section class="client-profile-picker__dialog">
      <header class="client-profile-picker__header">
        <h2 class="client-profile-picker__title">
          {{ title }}
        </h2>
        <button
          class="client-profile-picker__icon-button"
          aria-label="关闭"
          title="关闭"
          type="button"
          @click="emit('cancel')"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div class="client-profile-picker__content">
        <div
          v-if="profiles.length > 0"
          class="client-profile-picker__profile-list"
        >
          <button
            v-for="profile in profiles"
            :key="profile.id"
            class="client-profile-picker__profile"
            :class="{ 'client-profile-picker__profile--current': isCurrentProfile(profile) }"
            :disabled="isCurrentProfile(profile)"
            type="button"
            @click="emit('select', profile.id)"
          >
            <span class="client-profile-picker__profile-name"><UserBadge :user="profile" />
              {{ profile.name }}
              <span
                v-if="isCurrentProfile(profile)"
                class="client-profile-picker__current-label"
              >
                当前
              </span>
            </span>
            <span class="client-profile-picker__profile-id">{{ summarizeWebDevId(profile) }}</span>
          </button>
        </div>

        <form
          class="client-profile-picker__create-form"
          @submit.prevent="createProfile"
        >
          <label class="client-profile-picker__label">
            新建用户
            <input
              v-model="newProfileName"
              class="client-profile-picker__input"
              autocomplete="off"
              spellcheck="false"
            >
          </label>
          <button
            class="client-profile-picker__primary-button"
            :disabled="!canCreateProfile"
            type="submit"
          >
            新建并打开
          </button>
        </form>
      </div>
    </section>
  </div>
</template>

<style scoped>
.client-profile-picker {
  position: fixed;
  z-index: 2000;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 72px 24px 24px;
  background: rgb(15 23 42 / 32%);
}

.client-profile-picker__dialog {
  width: min(520px, 100%);
  overflow: hidden;
  border: 1px solid #34546f;
  border-radius: 8px;
  background: #101d2c;
  box-shadow: 0 16px 48px rgb(15 23 42 / 18%);
}

.client-profile-picker__header {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 14px 0 16px;
  border-bottom: 1px solid #263e54;
}

.client-profile-picker__title {
  margin: 0;
  color: #c7e5fb;
  font-size: 15px;
  font-weight: 650;
  line-height: 20px;
}

.client-profile-picker__icon-button {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #92b9d9;
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
}

.client-profile-picker__icon-button:hover {
  background: #152e48;
  color: #c7e5fb;
}

.client-profile-picker__content {
  display: grid;
  gap: 14px;
  padding: 14px;
}

.client-profile-picker__profile-list {
  display: grid;
  max-height: 280px;
  overflow: auto;
  gap: 6px;
}

.client-profile-picker__profile {
  display: grid;
  min-width: 0;
  gap: 2px;
  padding: 9px 10px;
  border: 1px solid #284258;
  border-radius: 6px;
  background: #091522;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.client-profile-picker__profile:hover {
  border-color: #92cdf3;
  background: #102239;
}

.client-profile-picker__profile:disabled {
  cursor: default;
}

.client-profile-picker__profile--current {
  border-color: #a4ddff;
  background: #152e48;
}

.client-profile-picker__profile-name {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: #c7e5fb;
  font-size: 13px;
  font-weight: 650;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.client-profile-picker__current-label {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 999px;
  background: #a4ddff;
  color: #092239;
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
}

.client-profile-picker__profile-id {
  overflow: hidden;
  color: #739ab9;
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.client-profile-picker__create-form {
  display: grid;
  gap: 10px;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
}

.client-profile-picker__label {
  display: grid;
  gap: 5px;
  color: #87afce;
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
}

.client-profile-picker__input {
  min-width: 0;
  height: 32px;
  padding: 0 9px;
  border: 1px solid #34546f;
  border-radius: 5px;
  color: #c7e5fb;
  font: inherit;
  font-size: 13px;
  font-weight: 400;
}

.client-profile-picker__input:focus {
  border-color: #a4ddff;
  outline: 2px solid rgb(37 99 235 / 16%);
}

.client-profile-picker__primary-button {
  color: #092239;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 5px;
  background: #a4ddff;
  color: #101d2c;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
}

.client-profile-picker__primary-button:disabled {
  background: #4f718e;
  cursor: default;
}
</style>
