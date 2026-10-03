<script setup lang="ts">
import { computed } from 'vue';
import {
  createLaunchValues,
  DevContainerIcon,
  LaunchFieldType,
  type LaunchSchema,
  type LaunchOverrides,
} from '@bsgames/dev-container-api';
const props = defineProps<{
  schema: LaunchSchema;
  values: LaunchOverrides;
}>();
const emit = defineEmits<{
  change: [values: LaunchOverrides];
}>();

const displayValues = computed(() => createLaunchValues(props.schema, props.values));

function change(key: string, event: Event) {
  const field = props.schema.properties[key],
        element = event.target as HTMLInputElement;
  const value = field.enum
    ? field.enum[Number(element.value)]
    : field.type === LaunchFieldType.boolean
      ? element.checked
      : field.type === LaunchFieldType.string
        ? element.value
        : Number(element.value);
  emit('change', {
    ...props.values,
    [key]: value,
  });
}

function toggle(key: string, event: Event) {
  const values = {
    ...props.values,
  };
  if ((event.target as HTMLInputElement).checked) {
    const field = props.schema.properties[key];
    Object.defineProperty(values, key, {
      value:
        field.default
        ?? field.enum?.[0]
        ?? (field.type === LaunchFieldType.boolean
          ? false
          : field.type === LaunchFieldType.string
            ? ''
            : 0),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    values[key] = null;
  }
  emit('change', values);
}
</script>
<template>
  <div class="launch-form">
    <div
      v-for="(field, key) in schema.properties"
      :key="key"
      class="launch-field"
      :class="{ 'launch-field--unset': displayValues[key] === undefined }"
    >
      <div class="launch-field-heading">
        <label
          :for="'launch-' + key"
          class="launch-field-title"
          :title="field.description"
        >{{ field.title ?? key
        }}<span
          v-if="schema.required?.includes(key)"
          class="required-mark"
        >＊</span></label><label
          v-if="!schema.required?.includes(key)"
          class="optional-toggle"
          :title="
            displayValues[key] === undefined ? '不传入此参数，点击启用' : '传入此参数，点击取消'
          "
        ><input
          type="checkbox"
          :aria-label="'设置 ' + key"
          :checked="displayValues[key] !== undefined"
          @change="toggle(key, $event)"
        ><DevContainerIcon
          :name="displayValues[key] === undefined ? 'eyeOff' : 'eye'"
        /></label>
      </div>

      <select
        v-if="field.enum"
        :id="'launch-' + key"
        :aria-label="String(key)"
        :disabled="displayValues[key] === undefined"
        :value="field.enum.indexOf(displayValues[key])"
        class="launch-field-input"
        @change="change(key, $event)"
      >
        <option
          v-for="(value, index) in field.enum"
          :key="index"
          :value="index"
        >
          {{ value }}
        </option>
      </select>
      <label
        v-else-if="field.type === LaunchFieldType.boolean"
        class="boolean-control"
      ><input
        :id="'launch-' + key"
        type="checkbox"
        :aria-label="String(key)"
        :disabled="displayValues[key] === undefined"
        :checked="displayValues[key] === true"
        @change="change(key, $event)"
      ><span class="boolean-track" /><span class="boolean-value">{{
        displayValues[key] === undefined ? '—' : displayValues[key] ? '开启' : '关闭'
      }}</span></label>
      <input
        v-else
        :id="'launch-' + key"
        :type="field.type === LaunchFieldType.string ? 'text' : 'number'"
        :step="field.type === LaunchFieldType.integer ? 1 : 'any'"
        :aria-label="String(key)"
        :disabled="displayValues[key] === undefined"
        :value="displayValues[key]"
        :placeholder="displayValues[key] === undefined ? '未设置' : ''"
        :min="field.minimum"
        :max="field.maximum"
        :minlength="field.minLength"
        :maxlength="field.maxLength"
        class="launch-field-input"
        @change="change(key, $event)"
      >
    </div>
  </div>
</template>
<style scoped>
.launch-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.launch-field {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 6px 0;
}
.launch-field-heading {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.launch-field-title {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-size: 11px;
  font-weight: 500;
  color: #bdd8ed;
}
.launch-field > .launch-field-input,
.launch-field > .boolean-control {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
}
.required-mark {
  font-size: 9px;
  color: #779ebc;
}
.optional-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: #779ebc;
  cursor: pointer;
  border-radius: 3px;
}
.optional-toggle input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.optional-toggle .dc-icon {
  width: 13px;
  height: 13px;
  pointer-events: none;
}
.optional-toggle input:checked + .dc-icon {
  color: #a4ddff;
}
.optional-toggle:hover {
  background: #1d3a55;
}
.optional-toggle:has(input:focus-visible) {
  outline: 1px solid #a4ddff;
  outline-offset: 2px;
}
.launch-field-input {
  width: 100%;
  min-height: 32px;
  border: 1px solid #34546f;
  border-radius: 4px;
  background: #091522;
  color: #c3e0f3;
  padding: 6px 9px;
  font-size: 12px;
  outline: none;
}
.launch-field-input:focus {
  border-color: #92cdf3;
}
.launch-field-input:disabled {
  opacity: 0.4;
}
.boolean-control {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  position: relative;
  cursor: pointer;
}
.boolean-control input {
  position: absolute;
  opacity: 0;
  width: 32px;
  height: 18px;
}
.boolean-track {
  width: 32px;
  height: 18px;
  background: #27445e;
  border-radius: 99px;
  position: relative;
}
.boolean-track:after {
  content: '';
  position: absolute;
  left: 3px;
  top: 3px;
  width: 12px;
  height: 12px;
  background: #789ab5;
  border-radius: 50%;
  transition: transform 0.15s;
}
.boolean-control input:checked + .boolean-track {
  background: #8ac9ef;
}
.boolean-control input:checked + .boolean-track:after {
  transform: translateX(14px);
  background: #092239;
}
.boolean-control input:focus-visible + .boolean-track {
  outline: 1px solid #a4ddff;
  outline-offset: 2px;
}
.boolean-control input:disabled + .boolean-track {
  opacity: 0.4;
}
.boolean-value {
  font-size: 11px;
  color: #779ebc;
}
@media (max-width: 600px) {
  .launch-field {
    grid-template-columns: 110px minmax(0, 1fr);
    gap: 8px;
  }
}
</style>
