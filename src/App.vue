<script setup lang="ts">
import { Toaster } from "@/components/ui/toast/";
import { useColorMode, useMagicKeys } from "@vueuse/core";
import DevPanel from "./components/DevPanel.vue";
import { useSystemStore } from "./store/systemStore";
import { MinusIcon, XIcon, FullscreenIcon } from "lucide-vue-next";
import { ref, watch } from "vue";
import { usePreference } from "./store/preferenceStore";
import Island from "./components/Island.vue";
import { NConfigProvider, darkTheme } from 'naive-ui'
const sys = useSystemStore();
const preferences = usePreference();
const keys = useMagicKeys();
const isRestored = ref(false);

const mode = useColorMode();

mode.value = "dark";

if (argon.isArgonHost) {
  document.body.style.setProperty("background", "transparent", "important");
}

const shiftCtrlA = keys["Shift+Ctrl+Digit9"];

const nativeControlsActive = ref(true);

watch(shiftCtrlA, (_) => {
  native.toggleDevTools();
});

const beginMove = () => {
  native.beginMoveWindow();
};

const pressSystemKey = (key: number) => {
  native.pressSystemKey(key);
};

const pressMaximize = () => {
  if (isRestored.value) {
    pressSystemKey(4);
  } else {
    pressSystemKey(3);
  }

  isRestored.value = !isRestored.value;
};

const endMove = () => {
  native.endMoveWindow();
};

const closeWindow = () => {
  if (preferences.minimizeToTrayOnClose) {
    pressSystemKey(2);
  } else {
    pressSystemKey(0);
  }
};
const themeOverrides = {
  common: {
    bodyColor: '#000000',
    cardColor: '#000000',
    modalColor: '#000000',
    popoverColor: '#000000',
    tableColor: '#000000',
    inputColor: '#09090b',
    tagColor: '#000000',

    textColorBase: '#fafafa',
    textColor1: '#fafafa',
    textColor2: '#a1a1aa',
    placeholderColor: '#71717a',
    borderColor: '#27272a',
    borderColorHover: '#3f3f46',
    dividerColor: '#27272a',

    primaryColor: '#6366f1',
    primaryColorHover: '#818cf8',
    primaryColorPressed: '#4f46e5',
    primaryColorSuppl: '#6366f1',

    borderRadius: '0.375rem',
    boxShadow1: 'none',
    boxShadow2: 'none',
    boxShadow3: 'none',
  },

  Input: {
    color: '#000000',
    colorFocus: '#000000',
    borderHover: '#3f3f46',
    borderRadius: '0.375rem',
    textColor: '#fafafa',
    placeholderColor: '#71717a',
    heightMedium: '2.5rem',
    boxShadowFocus: '0 0 0 2px rgba(99,102,241,0.6)'
  },

  Button: {
    borderRadiusMedium: '0.375rem',
    colorPrimary: '#6366f1',
    colorHoverPrimary: '#818cf8',
    colorPressedPrimary: '#4f46e5',
    textColorPrimary: '#fff',
    textColorHoverPrimary: '#fff',
    textColorPressedPrimary: '#fff',
    border: '1px solid #6366f1',
    boxShadow: '0 0 0 2px rgba(99,102,241,0.6)'
  },

  DatePicker: {
    panelColor: '#000000',
    borderRadius: '0.375rem',
    itemTextColorHover: '#fafafa',
    itemTextColorActive: '#ffffff',
    boxShadow: '0 0 0 2px rgba(99,102,241,0.6)',


    panelTextColor: '#fafafa',
    panelActionTextColor: '#fafafa',
    panelHeaderTextColor: '#fafafa',
    panelHeaderColor: '#000000',
    panelActionColor: '#000000',

    itemTextColorOverlay: '#fafafa',
    itemTextColorActiveOverlay: '#ffffff',
    itemColorOverlayHover: '#18181b',
    itemColorOverlayActive: '#18181b',

    itemColorHover: '#fff',
    itemColorActive: '#1e1e1e',

    itemTextColorCurrent: '#a1a1aa',
    itemTextColorDisabled: '#3f3f46',

  },

  Select: {
    peers: {
      InternalSelection: {
        borderRadius: '0.375rem',
        color: '#000000',
        boxShadow: '0 0 0 2px rgba(99,102,241,0.6)',
      },
    },
  },
}
</script>

<template>
  <NConfigProvider :theme="darkTheme" :theme-overrides="themeOverrides">

    <RouterView />
    <Toaster />
    <DevPanel />
    <Island class="select-none" v-if="sys.isRequestRetrying" :title="`Reconnecting`" />

    <div class="top-container  flex-col rounded-xl p-2 shadow-md justify-between" v-if="!nativeControlsActive">
      <div class="sys-keyholder">
        <MinusIcon height="16" width="16" class="close-icon" @click="pressSystemKey(1)" />
        <FullscreenIcon height="16" width="16" class="close-icon" @click="pressMaximize" />
        <XIcon height="16" width="16" class="close-icon" @click="closeWindow" />
      </div>
    </div>

    <div class="topbar-collider" @mousedown="beginMove" @mouseup="endMove" v-if="!nativeControlsActive" />
  </NConfigProvider>

</template>

<style scoped>
.warn-text {
  position: fixed;
  bottom: 10px;
  left: 10px;
  color: red;
  font-size: 20px;
  font-weight: bold;
  white-space: nowrap;
}

.top-container {
  position: absolute;
  right: 0;
  top: 0;
}


.close-icon {
  color: #686868;
}

.close-icon:hover {
  color: #bebebe;
  cursor: pointer;
}

.close-icon:active {
  color: #0f9ed6;
  cursor: pointer;
}

.topbar-collider {
  position: absolute;
  top: 0;
  left: 0;
  width: calc(100% - 90px);
  height: 25px;
}

.sys-keyholder {
  justify-content: center;
  display: flex;
  gap: 10px;
  flex: auto;
}
</style>
