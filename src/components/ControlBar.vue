<template>
    <div class="relative" style="z-index: 1;" v-if="me.me">
        <div class="control-bar">
            <div class="controls">
                <button :disabled="!voice.isConnected" @click="voice.disconnectFromChannel()" class="active">
                    <PhoneOffIcon class="w-5 h-5" />
                </button>
                <button @click="sys.toggleMicrophoneMute" :class="{ active: sys.microphoneMuted }">
                    <MicOff v-if="sys.microphoneMuted" class="w-5 h-5" />
                    <Mic v-else class="w-5 h-5" />
                </button>
                <button @click="sys.toggleHeadphoneMute" :class="{ active: sys.headphoneMuted }">
                    <HeadphoneOff v-if="sys.headphoneMuted" class="w-5 h-5" />
                    <Headphones v-else class="w-5 h-5" />
                </button>

                <button @click="toggleScreenCast" :class="{ active: voice.isSharing }"
                    :disabled="!voice.isConnected || voice.currentlyReconnect">
                    <ScreenShareOff v-if="voice.isSharing" class="w-5 h-5" />
                    <ScreenShare v-else class="w-5 h-5" />
                </button>

                <Dialog style="min-width: 620px !important" v-model:open="openShareSettings">

                    <DialogContent class="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>{{ t("screencast") }}</DialogTitle>
                            <DialogDescription>
                                {{ t("screencast_title") }}
                            </DialogDescription>
                        </DialogHeader>
                        <Tabs default-value="monitors">
                            <TabsList class="w-full flex">
                                <TabsTrigger value="monitors" class="flex-1">{{ t("monitors") }}</TabsTrigger>
                                <TabsTrigger value="windows" disabled class="flex-1">{{ t("windows") }}</TabsTrigger>
                            </TabsList>

                            <TabsContent value="monitors" class="mt-4">
                                <div class="grid grid-cols-2 gap-4">
                                    <div v-for="size in displays" :key="size.DisplayIndex"
                                        class="flex flex-col items-center" @click="setSelected(size)">
                                        <video autoplay :srcObject="size.preview" class="rounded-lg preview"
                                            :class="{ previewSelected: size.selected }"></video>
                                        <span class="text-sm mt-2">{{ t('monitor_index', { idx: size.DisplayIndex })
                                        }}</span>
                                    </div>
                                </div>
                                <div class="mt-4">
                                    <Label class="text-sm">{{ t("quality") }}</Label>
                                    <Select v-model="quality" :default-value="allSizes.at(0)?.title">
                                        <SelectTrigger>
                                            <SelectValue :placeholder="t('select_quality')" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem v-for="i in allSizes" :key="i.title" :value="i.title">
                                                {{ i.title }}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div class="mt-4">
                                    <Label class="text-sm">{{ t("fps") }}</Label>
                                    <Select v-model="fps">
                                        <SelectTrigger>
                                            <SelectValue :placeholder="t('select_fps')" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem v-for="i in allFps" :key="i.title" :value="i.value">
                                                {{ i.title }}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div class="mt-4 flex items-center gap-2">
                                    <Switch v-model="includeAudio" />
                                    <Label>{{ t("enable_system_sound") }}</Label>
                                </div>
                            </TabsContent>

                            <TabsContent value="windows" class="mt-4">
                                <div class="h-40 flex items-center justify-center bg-gray-200 rounded-lg">
                                    <span class="text-gray-500"> {{ t("window_preview") }}</span>
                                </div>
                                <div class="mt-4 flex items-center gap-2">
                                    <Switch v-model="includeAudio" />
                                    <Label>{{ t("enable_sound_from_window") }}</Label>
                                </div>
                            </TabsContent>
                        </Tabs>
                        <DialogFooter class="sm:justify-start">
                            <Button type="button" variant="default" @click="goShare()" style="width: 100%;">
                                {{ t("start") }}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
                <button :disabled="true">
                    <CameraIcon class="w-5 h-5" />
                </button>
                <button @click="toggleDoNotDistrurb">
                    <OctagonMinusIcon v-if="status == UserStatus.DoNotDisturb" class="w-5 h-5 text-red-600" />
                    <OctagonMinusIcon v-else class="w-5 h-5" />
                </button>
            </div>
        </div>
        <div>
            <div v-show="voice.isConnected || voice.isBeginConnect" v-motion-slide-visible-bottom
                class="connection-card absolute text-white rounded-t-lg p-3 shadow-2xl flex flex-col items-center z-[-1] "
                style="bottom: 100%; margin-bottom: -5px;">
                <div class="flex items-center space-x-2">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger as-child>
                                <div>
                                    <Signal class="w-4 h-4 text-green-500" v-if="voice.qualityConnection == 'GREEN'" />
                                    <Signal class="w-4 h-4 text-orange-500"
                                        v-else-if="voice.qualityConnection == 'ORANGE'" />
                                    <Signal class="w-4 h-4 text-red-500" v-else-if="voice.qualityConnection == 'RED'" />
                                    <Signal class="w-4 h-4 text-gray-500" v-else />
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p v-if="voice.isConnected">{{ voice.ping }}</p>
                                <p v-if="voice.isBeginConnect">??? ms</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <span class="font-semibold marquee">{{ voice.activeChannel?.name }}</span>
                </div>
                <span v-if="voice.isConnected" class="text-timer text-[#a2a6a8]">{{ sessionTimerStore.sessionTimer
                    }}</span>
                <span class="text-xs text-lime-400 mt-1"
                    v-if="voice.isConnected && !voice.currentlyReconnect">Connected</span>
                <span class="text-xs text-orange-400 mt-1"
                    v-if="voice.isBeginConnect && !voice.currentlyReconnect">Connecting...</span>
                <span class="text-xs text-orange-400 mt-1" v-if="voice.currentlyReconnect">Reconnect...</span>
            </div>
        </div>


    </div>
</template>

<script setup lang="ts">
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Mic,
  MicOff,
  HeadphoneOff,
  Headphones,
  Signal,
  PhoneOffIcon,
  ScreenShareOff,
  ScreenShare,
  TicketPercent,
  CameraIcon,
  OctagonMinusIcon,
} from "lucide-vue-next";

import { useMe } from "@/store/meStore";
import { useSystemStore } from "@/store/systemStore";
import { useVoice } from "@/store/voiceStore";
import { useSessionTimer } from "@/store/sessionTimer";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { onMounted, ref, watch } from "vue";
import { useLocale } from "@/store/localeStore";
import { UserStatus } from "@/lib/glue/argonChat";

const { t } = useLocale();

const me = useMe();
const sys = useSystemStore();
const voice = useVoice();
const sessionTimerStore = useSessionTimer();

const status = ref(me.me?.currentStatus);

watch(status, (newStatus) => {
  me.changeStatusTo(newStatus!);
});

const toggleDoNotDistrurb = () => {
  if (status.value === UserStatus.DoNotDisturb) status.value = UserStatus.Online;
  else status.value = UserStatus.DoNotDisturb;
};

const allSizes = [
  //{ title: "SVGA (600p)", h: 600, w: 800 },
  //{ title: "XGA (768p)", h: 768, w: 1024 },
  { title: "WXGA (720p)", h: 720, w: 1280, preset: "720p" },
  // { title: "WXGA+ (900p)", h: 900, w: 1440 },
  //{ title: "HD+ (900p)", h: 900, w: 1600 },
  { title: "Full HD (1080p)", h: 1080, w: 1920, preset: "1080p" },
  // { title: "WUXGA (1200p)", h: 1200, w: 1920 },
  { title: "QHD (1440p)", h: 1440, w: 2560, preset: "1440p" },
  // { title: "WQXGA (1600p)", h: 1600, w: 2560 },
  { title: "4K UHD (2160p)", h: 2160, w: 3840, preset: "2160p" },
  // { title: "5K (2880p)", h: 2880, w: 5120 },
  // { title: "8K UHD (4320p)", h: 4320, w: 7680 },
  // { title: "UWHD (1080p)", h: 1080, w: 2560 },
  //{ title: "UWQHD (1440p)", h: 1440, w: 3440 },
  // { title: "UWQHD+ (1600p)", h: 1600, w: 3840 },
  //{ title: "5K2K (2160p)", h: 2160, w: 5120 },
  // { title: "DFHD (1080p x2)", h: 1080, w: 3840 },
  // { title: "DQHD (1440p x2)", h: 1440, w: 5120 }
];

const allFps = [
  { title: "15fps", value: "15" },
  { title: "30fps", value: "30" },
  { title: "45fps", value: "45" },
  { title: "60fps", value: "60" },
  { title: "90fps", value: "90" },
  { title: "120fps", value: "120" },
  { title: "165fps", value: "165" },
];

const openShareSettings = ref(false);
const includeAudio = ref(false);
const quality = ref(allSizes.at(0)?.title);
const fps = ref("30");

interface IScreenWithPreview extends IScreen {
  preview: any;
  selected: boolean;
}

const displays = ref([] as IScreenWithPreview[]);

const setSelected = (size: IScreenWithPreview) => {
  for (const i of displays.value) {
    if (i.DisplayIndex === size.DisplayIndex) i.selected = true;
    else i.selected = false;
  }
};

const toggleScreenCast = () => {
  openShareSettings.value = false;
  if (!voice.isConnected) return;
  if (voice.isOtherUserSharing) return;

  if (voice.isSharing) voice.stopScreenShare();
  else {
    openShareSettings.value = true;
  }
};

async function getPreviewForScreen(display: IScreen) {
  if (!argon.isArgonHost) return new MediaStream();
    return new MediaStream();
  /*const p = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSourceId: `screen:${display.DisplayIndex}:0`,
        chromeMediaSource: "screen",
        maxWidth: 2220,
        maxHeight: 1210,
      },
    } as any,
  });

  return p;*/
}

async function getPreviewForWindow(window: IWindowInfo) {
  if (!argon.isArgonHost) return new MediaStream();
  const p = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSourceId: window.deviceId,
        chromeMediaSource: "desktop",
        maxWidth: 220,
        maxHeight: 110, 
      },
    } as any,
  });

  return p;
}

async function goShare() {
  openShareSettings.value = false;
  if (!voice.isConnected) return;
  if (voice.isOtherUserSharing) return;

  if (voice.isSharing) voice.stopScreenShare();
  else {
    const dev = displays.value.filter((x) => x.selected).at(0);
    await voice.startScreenShare({
      fps: +(fps.value ?? "30"),
      systemAudio: includeAudio.value ? "include" : "exclude",
      preset: quality.value as any,
      deviceId: `screen:${dev?.DisplayIndex}:0`,
      deviceKind: "screen",
    });
  }
}

onMounted(async () => {
  let sc = [] as IScreen[];

  if (argon.isArgonHost) {
    sc = native.getDisplays();
  } else {
    sc = [
      {
        DisplayIndex: "0",
        Freq: 165,
        Height: 1440,
        IsPrimary: true,
        Left: 0,
        Top: 0,
        Width: 2560,
      },
    ];
  }

  const sce = [] as IScreenWithPreview[];

  for (const i of sc) {
    sce.push({
      ...i,
      preview: await getPreviewForScreen(i),
      selected: sce.length === 0,
    });
  }

  displays.value = sce;
});
</script>

<style scoped>
.control-bar {
    background-color: #161616;
    border-radius: 15px;
    padding: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    position: relative;
}

.bad {
    color: #f04747;
}

.moderate {
    color: #f0d747
}

.good {
    color: #43b581;
}

.online {
    color: #43b581;
}

.away {
    color: #276e9e;
}

.ingame {
    color: #279e3b;
}

.offline {
    color: #635d5d;
}

.donotdisturb {
    color: #f04747;
}

.listen {
    color: #279e3b;
}

.touchgrass {
    color: #90279e;
}

.controls button {
    background: none;
    border: none;
    color: #fff;
    font-size: 16px;
    cursor: pointer;
    margin-left: 5px;
    transition: color 0.3s;
    margin: 5px;
}

.controls {
    justify-content: center;
    display: flex;
    gap: 6px;
    flex: auto;
}

.controls button:hover {
    color: #5865f2;
}

.controls button.active {
    color: #f04747;
}

.controls button:disabled {
    color: #4d4c4c;
    cursor: not-allowed;
}

.connection-card {
    background-color: #272626;
    text-align: center;
    margin-bottom: -5px;
    left: 10%;
    bottom: 100%;
    width: calc(100% - 50px);
}

.previewSelected {
    border: 2px solid #00ffad !important;
}

.preview {
    cursor: pointer;
    border: 2px solid #00ffae00;
}


.marquee {
    white-space: nowrap;
    display: inline-block;
}

@keyframes marquee {
    0% {
        left: 0;
    }

    100% {
        left: 100%;
        transform: translateX(-100%);
    }
}
</style>