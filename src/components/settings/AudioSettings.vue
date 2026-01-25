<template>
    <div v-if="loaded" class="space-y-6">
        <h2 class="text-2xl font-bold mb-6">{{ t("audio_system") }}</h2>

        <!-- Master Volume Card -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <Volume2Icon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t("master_volume") }}</h3>
            </div>
            
            <div class="volume-control-wrapper">
                <div class="volume-slider-container">
                    <VolumeXIcon class="w-4 h-4 text-muted-foreground" />
                    <Slider 
                        class="flex-1" 
                        :step="0.01" 
                        :max="1" 
                        v-model="soundLevel" 
                    />
                    <Volume2Icon class="w-5 h-5 text-primary" />
                </div>
                
                <div class="flex items-center gap-3 mt-3">
                    <div class="volume-display">
                        {{ Math.round(preferenceStore.soundLevel * 100) }}%
                    </div>
                    <Button 
                        @click="playTestSound" 
                        variant="outline" 
                        size="sm"
                        :disabled="isPlayingSound"
                        class="flex-1"
                    >
                        <PlayIcon v-if="!isPlayingSound" class="w-4 h-4 mr-2" />
                        <Loader2Icon v-else class="w-4 h-4 mr-2 animate-spin" />
                        {{ t("test_sound") }}
                    </Button>
                </div>
            </div>
        </div>

        <!-- Input Device (Microphone) -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <MicIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t("select_microphone") }}</h3>
            </div>
            
            <Select v-model="selectedMicrophone">
                <SelectTrigger class="w-full">
                    <SelectValue :placeholder="t('no_microphone')" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup v-for="device in audioDevices.filter(q => !!q.deviceId)" :key="device.deviceId">
                        <SelectItem :value="device.deviceId">
                            {{ formatDeviceLabel(device, t("noname_microphone")) }}
                        </SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>

            <!-- Input VU Meter -->
            <div class="mt-4 p-4 rounded-lg bg-background/50 border">
                <div class="flex items-center justify-between mb-3">
                    <span class="text-sm font-medium flex items-center gap-2">
                        <ActivityIcon class="w-4 h-4" />
                        {{ t("input_level") }}
                    </span>
                    <Button 
                        @click="isInputMonitoring = !isInputMonitoring" 
                        variant="ghost" 
                        size="sm"
                        class="h-8"
                    >
                        <VolumeIcon v-if="!isInputMonitoring" class="w-4 h-4" />
                        <VolumeXIcon v-if="isInputMonitoring" class="w-4 h-4" />
                        <span class="ml-2 text-xs">{{ isInputMonitoring ? t("mute") : t("monitor") }}</span>
                    </Button>
                </div>
                
                <div class="space-y-3">
                    <!-- Left Channel -->
                    <div class="space-y-1">
                        <div class="flex items-center justify-between">
                            <span class="text-xs text-muted-foreground font-medium">{{ t('left_channel') }}</span>
                            <span class="text-xs text-muted-foreground font-mono">{{ formatDb(inputLeftDb) }} dB</span>
                        </div>
                        <div class="volume-meter">
                            <div 
                                class="volume-fill"
                                :style="{ width: inputLeftVolume + '%', backgroundColor: audio.volumeColor(inputLeftVolume) }"
                            />
                        </div>
                    </div>
                    <!-- Right Channel -->
                    <div class="space-y-1">
                        <div class="flex items-center justify-between">
                            <span class="text-xs text-muted-foreground font-medium">{{ t('right_channel') }}</span>
                            <span class="text-xs text-muted-foreground font-mono">{{ formatDb(inputRightDb) }} dB</span>
                        </div>
                        <div class="volume-meter">
                            <div 
                                class="volume-fill"
                                :style="{ width: inputRightVolume + '%', backgroundColor: audio.volumeColor(inputRightVolume) }"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <!-- Microphone Settings -->
            <div class="mt-4 space-y-3">
                <div class="setting-item">
                    <div class="flex-1">
                        <div class="text-sm font-medium">{{ t("force_to_mono_voice") }}</div>
                        <div class="text-xs text-muted-foreground">{{ t("force_to_mono_voice_desc") }}</div>
                    </div>
                    <Switch :checked="preferenceStore.forceToMono" @update:checked="onChangeForceToMono" />
                </div>
                
                <div class="setting-item opacity-50">
                    <div class="flex-1">
                        <div class="text-sm font-medium">{{ t("noise_sup") }}</div>
                        <div class="text-xs text-muted-foreground">{{ t("noise_sup_desc") }}</div>
                    </div>
                    <Switch 
                        disabled 
                        :checked="preferenceStore.noiseSuppression" 
                    />
                </div>
            </div>
        </div>

        <!-- Output Device (Speakers/Headphones) -->
        <div class="setting-card">
            <div class="flex items-center justify-between mb-4">
                <div class="flex items-center gap-2">
                    <HeadphonesIcon class="w-5 h-5 text-primary" />
                    <h3 class="text-lg font-semibold">{{ t("select_output") }}</h3>
                </div>
            </div>
            
            <Select v-model="selectedAudioOutput">
                <SelectTrigger class="w-full">
                    <SelectValue :placeholder="t('no_speakers_found')" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup v-for="device in audioOutputs.filter(q => !!q.deviceId)" :key="device.deviceId">
                        <SelectItem :value="device.deviceId">
                            {{ formatDeviceLabel(device, t('unnamed_speaker')) }}
                        </SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>

            <!-- Output VU Meter -->
            <div class="mt-4 p-4 rounded-lg bg-background/50 border">
                <div class="flex items-center justify-between mb-3">
                    <span class="text-sm font-medium flex items-center gap-2">
                        <ActivityIcon class="w-4 h-4" />
                        {{ t("output_level") }}
                    </span>
                    <span class="text-xs text-muted-foreground">
                        {{ t("master_output") }}
                    </span>
                </div>
                
                <div class="space-y-3">
                    <!-- Left Channel -->
                    <div class="space-y-1">
                        <div class="flex items-center justify-between">
                            <span class="text-xs text-muted-foreground font-medium">{{ t('left_channel') }}</span>
                            <span class="text-xs text-muted-foreground font-mono">{{ formatDb(outputLeftDb) }} dB</span>
                        </div>
                        <div class="volume-meter">
                            <div 
                                class="volume-fill"
                                :style="{ width: outputLeftVolume + '%', backgroundColor: audio.volumeColor(outputLeftVolume) }"
                            />
                        </div>
                    </div>
                    <!-- Right Channel -->
                    <div class="space-y-1">
                        <div class="flex items-center justify-between">
                            <span class="text-xs text-muted-foreground font-medium">{{ t('right_channel') }}</span>
                            <span class="text-xs text-muted-foreground font-mono">{{ formatDb(outputRightDb) }} dB</span>
                        </div>
                        <div class="volume-meter">
                            <div 
                                class="volume-fill"
                                :style="{ width: outputRightVolume + '%', backgroundColor: audio.volumeColor(outputRightVolume) }"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Camera Section -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <VideoIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t("select_camera") }}</h3>
            </div>
            
            <Select 
                v-model="selectedCamera" 
                @update:modelValue="onCameraChange" 
                :disabled="videoDevices.length === 0"
            >
                <SelectTrigger class="w-full">
                    <SelectValue :placeholder="t('no_camera_found')" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup v-for="device in videoDevices.filter(q => !!q.deviceId)" :key="device.deviceId">
                        <SelectItem :value="device.deviceId">
                            {{ device.label || t('unnamed_camera') }}
                        </SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>

            <!-- Camera Preview -->
            <Transition name="camera-fade">
                <div v-if="videoActive" class="camera-preview-wrapper">
                    <div class="camera-preview">
                        <video ref="videoElement" autoplay playsinline class="media-engine-video"></video>
                        <div class="camera-overlay">
                            <div class="camera-status">
                                <div class="recording-indicator"></div>
                                <span class="text-xs font-medium">{{ t("camera_active") }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </Transition>
            
            <div v-if="!videoActive && videoDevices.length > 0" class="mt-4 flex justify-center">
                <Button @click="startVideoPreview" variant="outline" class="w-full max-w-xs">
                    <VideoIcon class="w-4 h-4 mr-2" />
                    {{ t("test_camera") }}
                </Button>
            </div>
            
            <div v-if="videoActive" class="mt-4 flex justify-center">
                <Button @click="stopVideoPreview" variant="outline">
                    <VideoOffIcon class="w-4 h-4 mr-2" />
                    {{ t("stop_preview") }}
                </Button>
            </div>
        </div>

        <!-- Sound Notifications -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <BellIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t("sound_notifications") }}</h3>
            </div>
            
            <div class="space-y-3">
                <div 
                    v-for="item in soundControllers" 
                    :key="item.name"
                    class="setting-item"
                >
                    <div class="flex-1">
                        <div class="text-sm font-medium">{{ t(item.name) }}</div>
                        <div class="text-xs text-muted-foreground">
                            {{ t(item.name + '_details') }}
                        </div>
                    </div>
                    <Switch 
                        :checked="item.r.value" 
                        @update:checked="(x: boolean) => item.r.value = x"
                    />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Button } from "@argon/ui/button";
import { Slider } from "@argon/ui/slider";
import { Switch } from "@argon/ui/switch";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@argon/ui/select";
import { audio } from "@/lib/audio/AudioManager";
import { worklets } from "@/lib/audio/WorkletBase";
import { DisposableBag, logger } from "@argon/core";
import { useLocale } from "@/store/localeStore";
import { usePreference } from "@/store/preferenceStore";
import { useTone } from "@/store/toneStore";
import { 
    MicIcon, 
    HeadphonesIcon,
    VideoIcon, 
    VideoOffIcon,
    ActivityIcon,
    VolumeIcon,
    Volume2Icon,
    VolumeXIcon,
    PlayIcon,
    Loader2Icon,
    BellIcon,
} from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { watchArray } from "@vueuse/core";
import type { Subscription } from "rxjs";

const { t } = useLocale();
const preferenceStore = usePreference();
const tone = useTone();

// Helpers
const formatDb = (db: number): string => {
    if (!isFinite(db) || db < -60) return '-∞';
    return db.toFixed(1);
};

// Device refs
const selectedMicrophone = ref("");
const selectedAudioOutput = ref("");
const selectedCamera = ref("");
const audioDevices = ref<MediaDeviceInfo[]>([]);
const videoDevices = ref<MediaDeviceInfo[]>([]);
const audioOutputs = ref<MediaDeviceInfo[]>([]);

// Video refs
const videoStream = ref<MediaStream | null>(null);
const videoElement = ref<HTMLVideoElement | null>(null);
const videoActive = ref(false);

// State
const loaded = ref(false);
const isPlayingSound = ref(false);

// Sound level
const soundLevel = ref([preferenceStore.soundLevel]);

watchArray(soundLevel, (newList) => {
    preferenceStore.soundLevel = newList[0];
});

// Sound controllers
const {
    isEnable_playSoftEnterSound,
    isEnable_playReconnectSound,
    isEnable_playSoftLeaveSound,
    isEnable_playMuteAllSound,
    isEnable_playUnmuteAllSound,
    isEnable_playNotificationSound,
    isEnable_playRingSound,
} = storeToRefs(preferenceStore);

const soundControllers = [
    { r: isEnable_playSoftEnterSound, name: "playSoftEnterSound" },
    { r: isEnable_playReconnectSound, name: "playReconnectSound" },
    { r: isEnable_playSoftLeaveSound, name: "playSoftLeaveSound" },
    { r: isEnable_playMuteAllSound, name: "playMuteAllSound" },
    { r: isEnable_playUnmuteAllSound, name: "playUnmuteAllSound" },
    { r: isEnable_playNotificationSound, name: "playNotificationSound" },
    { r: isEnable_playRingSound, name: "playRingSound" },
];

// Input VU Meter
const inputLeftVolume = ref(0);
const inputRightVolume = ref(0);
const inputLeftDb = ref(-Infinity);
const inputRightDb = ref(-Infinity);
const isInputMonitoring = ref(false);
const isInputVUEnabled = ref(false);

// Output VU Meter
const outputLeftVolume = ref(0);
const outputRightVolume = ref(0);
const outputLeftDb = ref(-Infinity);
const outputRightDb = ref(-Infinity);

// Monitoring state
let inputSource: MediaStreamAudioSourceNode | null = null;
let inputMediaStream: MediaStream | null = null;
let monitoringAudio: HTMLAudioElement | null = null;
const stmNode = ref<AudioWorkletNode | null>(null);
const inputDisposables = new DisposableBag();

// Device subscriptions
const deviceSubscriptions: Subscription[] = [];

// Helpers
const formatDeviceLabel = (device: MediaDeviceInfo, fallback: string): string => {
    if (device.deviceId === 'default') {
        return (device.label.trimStart().replace(/^-/, "") || fallback) + ' 🔸';
    }
    return device.label || fallback;
};

const percentToDb = (percent: number): number => {
    if (percent <= 0) return -Infinity;
    const amplitude = Math.pow(percent / 100, 1 / 0.3);
    return 20 * Math.log10(amplitude);
};

// Smooth dB values for input
watch([inputLeftVolume, inputRightVolume], ([left, right]) => {
    const leftDb = percentToDb(left);
    const rightDb = percentToDb(right);
    const smoothing = 0.3;
    
    inputLeftDb.value = !isFinite(inputLeftDb.value) 
        ? leftDb 
        : inputLeftDb.value + (leftDb - inputLeftDb.value) * smoothing;
    
    inputRightDb.value = !isFinite(inputRightDb.value) 
        ? rightDb 
        : inputRightDb.value + (rightDb - inputRightDb.value) * smoothing;
});

// Smooth dB values for output
watch([outputLeftVolume, outputRightVolume], ([left, right]) => {
    const leftDb = percentToDb(left);
    const rightDb = percentToDb(right);
    const smoothing = 0.3;
    
    outputLeftDb.value = !isFinite(outputLeftDb.value) 
        ? leftDb 
        : outputLeftDb.value + (leftDb - outputLeftDb.value) * smoothing;
    
    outputRightDb.value = !isFinite(outputRightDb.value) 
        ? rightDb 
        : outputRightDb.value + (rightDb - outputRightDb.value) * smoothing;
});

// Device watchers
watch(selectedAudioOutput, async (x) => {
    logger.info("selectedAudioOutput", x);
    try {
        await audio.setOutputDevice(x);
    } catch (err) {
        logger.error("Failed to set output device:", err);
    }
});

watch(selectedMicrophone, async (x) => {
    logger.info("selectedMicrophone", x);
    try {
        await audio.setInputDevice(x);
        stopInputMonitoring();
        await startInputMonitoring();
    } catch (err) {
        logger.error("Failed to set input device:", err);
    }
});

watch(isInputMonitoring, (x) => {
    if (monitoringAudio) monitoringAudio.muted = !x;
});

watch(isInputVUEnabled, () => {
    inputLeftVolume.value = 0;
    inputRightVolume.value = 0;
    inputLeftDb.value = -Infinity;
    inputRightDb.value = -Infinity;
});

// Device list management
async function refreshDeviceLists() {
    audioDevices.value = await audio.enumerateDevicesByKind("audioinput");
    videoDevices.value = await audio.enumerateDevicesByKind("videoinput");
    audioOutputs.value = await audio.enumerateDevicesByKind("audiooutput");
}

// Input monitoring
async function startInputMonitoring() {
    if (isInputVUEnabled.value) {
        stopInputMonitoring();
        return;
    }

    try {
        inputMediaStream = await audio.createRawInputMediaStream();
        inputSource = audio.getCurrentAudioContext().createMediaStreamSource(inputMediaStream);

        const vuNode = (await worklets.createVUMeter(inputLeftVolume, inputRightVolume))
            .injectInto(inputDisposables);

        const stm = (await worklets.createStereoToMonoProcessor())
            .injectInto(inputDisposables);

        worklets.setEnabledVUNode(stm, preferenceStore.forceToMono);
        const dest = audio.getCurrentAudioContext().createMediaStreamDestination();

        inputSource.connect(stm);
        stm.connect(dest);
        stm.connect(vuNode);

        stmNode.value = stm;

        monitoringAudio = (await audio.createAudioElement(dest.stream))
            .injectInto(inputDisposables);
        monitoringAudio.muted = !isInputMonitoring.value;
        isInputVUEnabled.value = true;
    } catch (err) {
        logger.error("Microphone access error:", err);
    }
}

function stopInputMonitoring() {
    inputDisposables.dispose();
    isInputVUEnabled.value = false;

    inputSource?.disconnect();
    for (const track of inputMediaStream?.getTracks() ?? []) {
        track.stop();
    }

    inputSource = null;
    inputMediaStream = null;
    stmNode.value = null;

    setTimeout(() => {
        inputLeftVolume.value = 0;
        inputRightVolume.value = 0;
        inputLeftDb.value = -Infinity;
        inputRightDb.value = -Infinity;
    }, 50);
}

// Output monitoring
let outputVUMeter: { dispose: () => void } | null = null;

async function startOutputMonitoring() {
    try {
        const vuMeter = await audio.createVirtualVUMeterStereo((left, right) => {
            outputLeftVolume.value = left;
            outputRightVolume.value = right;
        });

        outputVUMeter = vuMeter;
    } catch (err) {
        logger.error("Output monitoring error:", err);
    }
}

function stopOutputMonitoring() {
    outputVUMeter?.dispose();
    outputVUMeter = null;
    outputLeftVolume.value = 0;
    outputRightVolume.value = 0;
    outputLeftDb.value = -Infinity;
    outputRightDb.value = -Infinity;
}

// Force to mono
async function onChangeForceToMono(x: boolean) {
    preferenceStore.forceToMono = x;
    if (stmNode.value) {
        worklets.setEnabledVUNode(stmNode.value, x);
    }
}

// Test sound
const playTestSound = async () => {
    isPlayingSound.value = true;
    if (Math.random() > 0.5) tone.playSoftEnterSound();
    else tone.playSoftLeaveSound();
    
    setTimeout(() => {
        isPlayingSound.value = false;
    }, 500);
};

// Video preview
const startVideoPreview = async () => {
    try {
        if (!selectedCamera.value && videoDevices.value.length > 0) {
            selectedCamera.value = videoDevices.value[0].deviceId;
        }
        
        videoActive.value = true;
        await nextTick();
        await updateVideoStream();
    } catch (error) {
        logger.error("Failed to start video preview:", error);
        videoActive.value = false;
    }
};

const updateVideoStream = async () => {
    if (!selectedCamera.value) return;
    
    preferenceStore.defaultVideoDevice = selectedCamera.value;
    if (videoStream.value) {
        videoStream.value.getTracks().forEach(track => track.stop());
    }
    
    try {
        const constraints: MediaStreamConstraints = {
            video: selectedCamera.value === 'default' 
                ? true 
                : { deviceId: { exact: selectedCamera.value } }
        };
        
        videoStream.value = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (videoElement.value) {
            videoElement.value.srcObject = videoStream.value;
            await videoElement.value.play().catch(() => {});
        }
    } catch (error) {
        logger.error('Error accessing video stream:', error);
    }
};

const stopVideoPreview = () => {
    if (videoStream.value) {
        videoStream.value.getTracks().forEach(track => track.stop());
        videoStream.value = null;
    }
    if (videoElement.value) {
        videoElement.value.srcObject = null;
    }
    videoActive.value = false;
};

const onCameraChange = async () => {
    if (videoActive.value) {
        await updateVideoStream();
    }
};

// Lifecycle
onMounted(async () => {
    await refreshDeviceLists();

    selectedMicrophone.value = audio.getInputDevice().value ?? "default";
    selectedAudioOutput.value = audio.getOutputDevice().value ?? "default";
    selectedCamera.value = preferenceStore.defaultVideoDevice || (videoDevices.value[0]?.deviceId ?? "");

    // Subscribe to device changes
    deviceSubscriptions.push(
        audio.onDevicesChanged(() => refreshDeviceLists()),
        audio.onInputDeviceChanged((deviceId) => {
            if (deviceId !== selectedMicrophone.value) {
                selectedMicrophone.value = deviceId;
            }
        }),
        audio.onOutputDeviceChanged((deviceId) => {
            if (deviceId !== selectedAudioOutput.value) {
                selectedAudioOutput.value = deviceId;
            }
        }),
    );

    loaded.value = true;

    await startInputMonitoring();
    await startOutputMonitoring();
});

onBeforeUnmount(() => {
    if (videoStream.value) {
        for (const track of videoStream.value.getTracks()) {
            track.stop();
        }
    }
});

onUnmounted(() => {
    stopInputMonitoring();
    stopOutputMonitoring();
    deviceSubscriptions.forEach(sub => sub.unsubscribe());
    deviceSubscriptions.length = 0;
});
</script>

<style scoped>
.setting-card {
    @apply rounded-xl border bg-card p-6 shadow-sm transition-all hover:shadow-md;
}

.setting-item {
    @apply flex items-center justify-between gap-4 p-3 rounded-lg bg-background/30 border transition-colors hover:bg-background/50;
}

.volume-control-wrapper {
    @apply space-y-4;
}

.volume-slider-container {
    @apply flex items-center gap-4;
}

.volume-display {
    @apply px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-center font-mono text-lg font-bold text-primary min-w-[80px];
}

.volume-meter {
    @apply w-full h-2 bg-muted rounded-full overflow-hidden relative;
}

.volume-fill {
    @apply h-full transition-all duration-75 ease-out rounded-full;
    box-shadow: 0 0 8px currentColor;
}

.camera-preview-wrapper {
    @apply mt-6;
}

.camera-preview {
    @apply relative w-full rounded-xl overflow-hidden border-2 border-primary/20 shadow-lg;
    background: linear-gradient(135deg, rgba(0,0,0,0.9) 0%, rgba(20,20,20,0.95) 100%);
}

.media-engine-video {
    @apply w-full h-auto aspect-video object-cover;
}

.camera-overlay {
    @apply absolute top-0 left-0 right-0 p-4;
    background: linear-gradient(180deg, rgba(0,0,0,0.6) 0%, transparent 100%);
}

.camera-status {
    @apply flex items-center gap-2 text-white;
}

.recording-indicator {
    @apply w-2 h-2 rounded-full bg-red-500;
    animation: pulse-recording 2s ease-in-out infinite;
}

@keyframes pulse-recording {
    0%, 100% {
        opacity: 1;
        transform: scale(1);
    }
    50% {
        opacity: 0.5;
        transform: scale(1.2);
    }
}

.camera-fade-enter-active,
.camera-fade-leave-active {
    transition: all 0.3s ease;
}

.camera-fade-enter-from {
    opacity: 0;
    transform: translateY(-10px);
}

.camera-fade-leave-to {
    opacity: 0;
    transform: translateY(10px);
}
</style>
