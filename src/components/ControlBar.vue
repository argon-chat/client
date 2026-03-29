<template>
    <div v-if="me.me" class="control-bar">
        <div class="controls">
            <button :disabled="!isConnected" @click="endActiveCall" class="active">
                <PhoneOffIcon class="w-5 h-5" />
            </button>

            <button @click="toggleMic" :class="{ active: isMicMuted }">
                <MicOff v-if="isMicMuted" class="w-5 h-5" />
                <Mic v-else class="w-5 h-5" />
            </button>

            <button @click="sys.toggleHeadphoneMute" :class="{ active: sys.headphoneMuted }">
                <HeadphoneOff v-if="sys.headphoneMuted" class="w-5 h-5" />
                <Headphones v-else class="w-5 h-5" />
            </button>

            <button @click="toggleScreenCast" :class="{ active: voice.isSharing }" :disabled="!isConnected">
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
                                <TabsTrigger value="monitors" class="flex-1">
                                    {{ t("monitors") }}
                                </TabsTrigger>
                                <TabsTrigger value="windows" disabled class="flex-1">
                                    {{ t("windows") }}
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent value="monitors" class="mt-4">
                                <div class="grid grid-cols-2 gap-4">
                                    <div v-for="size in displays" :key="size.displayIndex"
                                        class="flex flex-col items-center" @click="setSelected(size)">
                                        <!--  <video autoplay :srcObject="size.preview" class="rounded-lg preview"
                                            :class="{ previewSelected: size.selected }"></video>
                                            <div class="grid">
                                            <img :src="`screen://preview?id=${size.displayIndex}`" />
                                        </div> -->

                                        
                                        <span class="text-sm mt-2">
                                            {{ t("monitor_index", { idx: size.displayIndex }) }}
                                        </span>
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
                                    <span class="text-gray-500">
                                        {{ t("window_preview") }}
                                    </span>
                                </div>
                                <div class="mt-4 flex items-center gap-2">
                                    <Switch v-model="includeAudio" />
                                    <Label>{{ t("enable_sound_from_window") }}</Label>
                                </div>
                            </TabsContent>
                        </Tabs>
                        <DialogFooter class="sm:justify-start">
                            <Button type="button" variant="default" @click="goShare" style="width: 100%;">
                                {{ t("start") }}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <button :disabled="true">
                    <CameraIcon class="w-5 h-5" />
                </button>

                <button v-if="playframeActive"
                    @click="activity.openPicker()" 
                    :disabled="!isConnected"
                    :class="{ active: activity.isActive }"
                    :title="isConnected ? 'Start Activity' : 'Join voice to start activity'"
                >
                    <Gamepad2 class="w-5 h-5" />
                </button>

                <button @click="toggleDoNotDistrurb">
                    <OctagonMinusIcon v-if="status == UserStatus.DoNotDisturb" class="w-5 h-5 text-red-600" />
                    <OctagonMinusIcon v-else class="w-5 h-5" />
                </button>
            </div>
    </div>
</template>

<script setup lang="ts">
import {
    Mic,
    MicOff,
    HeadphoneOff,
    Headphones,
    PhoneOffIcon,
    ScreenShareOff,
    ScreenShare,
    CameraIcon,
    OctagonMinusIcon,
    Gamepad2,
} from "lucide-vue-next";
import { useMe } from "@/store/meStore";
import { useSystemStore } from "@/store/systemStore";
import { Label } from "@argon/ui/label";
import { Button } from "@argon/ui/button";
import { Switch } from "@argon/ui/switch";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogTitle,
    DialogDescription,
    DialogHeader,
} from "@argon/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@argon/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@argon/ui/tabs";
import { computed, ref, watch } from "vue";
import { useLocale } from "@/store/localeStore";
import { UserStatus } from "@argon/glue";
import { useUnifiedCall } from "@/store/unifiedCallStore";
import { useApi } from "@/store/apiStore";
import { usePlayFrameActivity } from "@/store/playframeStore";

import { Screen } from "@argon/glue/ipc";
import { native } from "@argon/glue/native";
import { useFeatureFlags } from "@/store/featureFlagsStore";

const voice = useUnifiedCall();
const api = useApi();
const activity = usePlayFrameActivity();
const { playframeActive } = useFeatureFlags();

const { t } = useLocale();
const me = useMe();
const sys = useSystemStore();

const status = ref(me.me?.currentStatus);
watch(status, (newStatus) => me.changeStatusTo(newStatus!));

const toggleDoNotDistrurb = () => {
    status.value =
        status.value === UserStatus.DoNotDisturb
            ? UserStatus.Online
            : UserStatus.DoNotDisturb;
};

const allSizes = [
    { title: "WXGA (720p)", h: 720, w: 1280, preset: "720p" },
    { title: "Full HD (1080p)", h: 1080, w: 1920, preset: "1080p" },
    { title: "QHD (1440p)", h: 1440, w: 2560, preset: "1440p" },
    { title: "4K UHD (2160p)", h: 2160, w: 3840, preset: "2160p" },
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

interface IScreenWithPreview extends Screen {
    preview: MediaStream | null;
    selected: boolean;
}

const displays = ref<IScreenWithPreview[]>([]);

const setSelected = (screen: IScreenWithPreview) => {
    for (const d of displays.value) d.selected = d.displayIndex === screen.displayIndex;
};

async function getPreviewForScreen(display: Screen): Promise<MediaStream> {
    if (!argon.isArgonHost) return new MediaStream();
    return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            mandatory: {
                chromeMediaSourceId: `screen:${display.displayIndex}:0`,
                chromeMediaSource: "screen",
                maxWidth: 220,
                maxHeight: 110,
            },
        } as any,
    });
}

function stopPreview(stream: MediaStream | null) {
    if (!stream) return;
    for (const track of stream.getTracks()) track.stop();
}

watch(openShareSettings, async (isOpen) => {
    if (isOpen) {

        goShare();
        return;
        let screens: Screen[] = [];

        if (argon.isArgonHost) {
            screens = await native.hostProc.getDisplays();
        } else {
            screens = [
                {
                    displayIndex: 0,
                    freq: 165,
                    height: 1440,
                    isPrimary: true,
                    left: 0,
                    top: 0,
                    width: 2560,
                },
            ];
        }

        const result: IScreenWithPreview[] = [];
        for (const screen of screens) {
            const preview = await getPreviewForScreen(screen);
            result.push({
                ...screen,
                preview,
                selected: result.length === 0,
            });
        }
        displays.value = result;
    } else {
        for (const d of displays.value) stopPreview(d.preview);
        displays.value = [];
    }
});

const isConnected = computed(() => voice.isConnected);
const isConnecting = computed(() => voice.isConnecting);

const isMicMuted = computed(() => {
    return sys.microphoneMuted;
});

function toggleMic() {
    sys.toggleMicrophoneMute();
}

async function endActiveCall() {
    if (voice.mode === "dm" && voice.callId) {
        try {
            await api.callInteraction.HangupCall(voice.callId);
        } catch (e) {
            console.warn("HangupCall failed", e);
        }
    }
    await voice.leave();
}

const toggleScreenCast = () => {
    if (!isConnected.value) return;

    if (voice.isSharing) {
        voice.stopScreenShare();
    } else {
        openShareSettings.value = true;
    }
};

async function goShare() {
    openShareSettings.value = false;
    if (!isConnected.value) return;

    if (voice.isSharing) {
        await voice.stopScreenShare();
    } else {
        //const dev = displays.value.find((x) => x.selected);
        //for (const d of displays.value) stopPreview(d.preview);
        //displays.value = [];

        //if (!dev) return;

        await voice.startScreenShare({
            deviceId: null,
            //deviceId: `screen:${dev.displayIndex}:0`,
            systemAudio: includeAudio.value ? "include" : "exclude",
        });
    }
}
</script>

<style scoped>
.control-bar {
    background-color: hsl(var(--card));
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: 15px;
    padding: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* Control buttons */
.controls {
    justify-content: center;
    display: flex;
    gap: 6px;
    flex: auto;
}

.controls button {
    background: none;
    border: none;
    color: hsl(var(--foreground));
    font-size: 16px;
    cursor: pointer;
    transition: color 0.2s;
    padding: 5px;
}

.controls button:hover {
    color: hsl(var(--primary));
}

.controls button.active {
    color: hsl(var(--destructive));
}

.controls button:disabled {
    color: hsl(var(--muted-foreground) / 0.35);
    cursor: not-allowed;
}

.previewSelected {
    border: 2px solid #00ffad !important;
}

.preview {
    cursor: pointer;
    border: 2px solid #00ffae00;
}
</style>

