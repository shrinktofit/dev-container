<script setup lang="ts">
import { ref, onBeforeUnmount, type CSSProperties } from 'vue';
const props = defineProps<{
  sizeMode: string;
}>();
const emit = defineEmits<{
  size: [mode: string];
  configure: [];
}>();
interface ControlOrbDragState {
  dragged: boolean;
  element: HTMLElement;
  pointerId: number;
  startClientX: number;
  startClientY: number;
}
const viewportElement = ref<HTMLElement>(),
      floatingControlOpen = ref(false),
      controlOrbDragging = ref(false);
const controlOrbPositionPercent = ref({
  x: 92,
  y: 12,
});
const controlOrbMargin = 10,
      controlOrbSize = 44,
      dragClickThreshold = 4;
let controlOrbDragState: ControlOrbDragState | undefined,
    suppressNextControlOrbClick = false;
const modes = {
  adaptive: '自适应',
  fitWidth: '适应宽度',
  fitHeight: '适应高度',
};

function configure() {
  floatingControlOpen.value = false;
  emit('configure');
}

function getFloatingControlOrbStyle(): CSSProperties {
  const position = normalizeControlOrbPosition(controlOrbPositionPercent.value);
  return {
    left: `${position.x}%`,
    top: `${position.y}%`,
  };
}

function getFloatingControlPopupStyle(): CSSProperties {
  const position = normalizeControlOrbPosition(controlOrbPositionPercent.value);
  return {
    left: `${position.x}%`,
    top: `${position.y}%`,
    transform: `translate(${position.x > 50 ? 'calc(-100% - 18px)' : '18px'}, ${position.y > 50 ? 'calc(-100% - 18px)' : '18px'})`,
  };
}

function handleControlOrbClick(): void {
  if (suppressNextControlOrbClick) {
    suppressNextControlOrbClick = false;
    return;
  }
  floatingControlOpen.value = !floatingControlOpen.value;
}

function handleControlOrbPointerDown(event: PointerEvent): void {
  if (event.button !== 0) {
    return;
  }
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  target.setPointerCapture(event.pointerId);
  controlOrbDragState = {
    dragged: false,
    element: target,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
  };
  window.addEventListener('pointermove', handleControlOrbPointerMove);
  window.addEventListener('pointerup', handleControlOrbPointerUp);
  window.addEventListener('pointercancel', handleControlOrbPointerCancel);
  event.preventDefault();
}

function handleControlOrbPointerMove(event: PointerEvent): void {
  if (event.pointerId !== controlOrbDragState?.pointerId) {
    return;
  }
  const dragDistance = Math.hypot(
    event.clientX - controlOrbDragState.startClientX,
    event.clientY - controlOrbDragState.startClientY,
  );
  if (dragDistance >= dragClickThreshold) {
    controlOrbDragState.dragged = true;
    controlOrbDragging.value = true;
    floatingControlOpen.value = false;
  }
  if (!controlOrbDragState.dragged) {
    return;
  }
  updateControlOrbPositionFromPointer(event);
}

function handleControlOrbPointerUp(event: PointerEvent): void {
  if (event.pointerId !== controlOrbDragState?.pointerId) {
    return;
  }
  const dragState = controlOrbDragState;
  suppressNextControlOrbClick = dragState.dragged;
  releaseControlOrbPointerCapture(dragState);
  controlOrbDragState = undefined;
  controlOrbDragging.value = false;
  removeControlOrbDragListeners();
}

function handleControlOrbPointerCancel(): void {
  if (controlOrbDragState) {
    releaseControlOrbPointerCapture(controlOrbDragState);
  }
  controlOrbDragState = undefined;
  controlOrbDragging.value = false;
  removeControlOrbDragListeners();
}

function updateControlOrbPositionFromPointer(event: PointerEvent): void {
  const container = viewportElement.value;
  if (!container) {
    return;
  }
  const rect = container.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }
  const radius = controlOrbSize / 2;
  const minX = controlOrbMargin + radius;
  const maxX = Math.max(minX, rect.width - controlOrbMargin - radius);
  const minY = controlOrbMargin + radius;
  const maxY = Math.max(minY, rect.height - controlOrbMargin - radius);
  const x = clamp(event.clientX - rect.left, minX, maxX);
  const y = clamp(event.clientY - rect.top, minY, maxY);
  controlOrbPositionPercent.value = {
    x: (x / rect.width) * 100,
    y: (y / rect.height) * 100,
  };
}

function removeControlOrbDragListeners(): void {
  window.removeEventListener('pointermove', handleControlOrbPointerMove);
  window.removeEventListener('pointerup', handleControlOrbPointerUp);
  window.removeEventListener('pointercancel', handleControlOrbPointerCancel);
}

function releaseControlOrbPointerCapture(dragState: ControlOrbDragState): void {
  if (dragState.element.hasPointerCapture(dragState.pointerId)) {
    dragState.element.releasePointerCapture(dragState.pointerId);
  }
}

function normalizeControlOrbPosition(position: { x: number; y: number }) {
  return {
    x: clamp(position.x, 0, 100),
    y: clamp(position.y, 0, 100),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

onBeforeUnmount(handleControlOrbPointerCancel);
</script>
<template>
  <div
    ref="viewportElement"
    class="floating-control-layer"
  >
    <div
      v-if="floatingControlOpen"
      class="floating-control-popup"
      :style="getFloatingControlPopupStyle()"
    >
      <div class="debug-menu">
        <div class="debug-menu-section-title">
          窗口大小
        </div><button
          v-for="(label, mode) in modes"
          :key="mode"
          class="debug-menu-item"
          :class="{ 'debug-menu-item--active': props.sizeMode === mode }"
          type="button"
          @click="emit('size', mode)"
        >
          {{ label }}
        </button>
      </div>
      <v-btn
        class="floating-control-config-button"
        variant="tonal"
        block
        @click="configure"
      >
        打开启动配置
      </v-btn>
    </div>
    <button
      class="floating-control-orb"
      :class="{ 'floating-control-orb--dragging': controlOrbDragging }"
      :style="getFloatingControlOrbStyle()"
      type="button"
      aria-label="打开辅助区"
      title="打开辅助区"
      @click="handleControlOrbClick"
      @pointerdown="handleControlOrbPointerDown"
    />
  </div>
</template>
<style scoped>
.floating-control-layer {
  position: absolute;
  z-index: 10;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.floating-control-orb {
  position: absolute;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid rgb(255 255 255 / 72%);
  border-radius: 999px;
  background: rgb(37 99 235 / 50%);
  box-shadow: 0 8px 24px rgb(15 23 42 / 24%);
  color: #ffffff;
  cursor: grab;
  pointer-events: auto;
  touch-action: none;
  transform: translate(-50%, -50%);
}

.floating-control-orb::before {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  box-shadow:
    -9px 0 0 currentColor,
    9px 0 0 currentColor;
  content: '';
  transform: translate(-50%, -50%);
}

.floating-control-orb:hover,
.floating-control-orb:focus-visible {
  background: rgb(29 78 216 / 84%);
}

.floating-control-orb:focus-visible {
  outline: 3px solid rgb(37 99 235 / 28%);
  outline-offset: 3px;
}

.floating-control-orb--dragging {
  cursor: grabbing;
}

.floating-control-popup {
  position: absolute;
  width: 224px;
  padding: 8px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 12px 32px rgb(15 23 42 / 18%);
  pointer-events: auto;
}

.floating-control-config-button {
  margin-top: 8px;
}

.debug-menu {
  display: grid;
  gap: 4px;
}

.debug-menu-section-title {
  padding: 2px 4px 5px;
  color: #64748b;
  font-size: 11px;
  font-weight: 650;
  line-height: 16px;
}

.debug-menu-item {
  width: 100%;
  min-height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #0f172a;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  text-align: left;
}

.debug-menu-item:hover {
  background: #eff6ff;
  color: #1d4ed8;
}

.debug-menu-item--active {
  background: #dbeafe;
  color: #1d4ed8;
  font-weight: 650;
}
</style>
