<template>
    <div v-if="loaded">
        <h2 class="text-xl font-bold mb-4">{{ t("voice_video_settings") }}</h2>

        <div class="rounded-lg border p-4">
            <label class="block font-semibold mb-1">{{ t("select_microphone") }}</label>
            <Select v-model="selectedMicrophone">
                <SelectTrigger>
                    <SelectValue placeholder="No microphones found" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup v-for="device in audioDevices.filter(q => !!q.deviceId)" :key="device.deviceId"
                        :value="device.deviceId">
                        <SelectItem :value="device.deviceId">
                            {{ device.label || 'Unnamed Microphone' }}
                        </SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>
            <br/>
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        {{ t("force_to_mono_voice") }}
                    </div>
                    <div class="text-sm text-muted-foreground">
                        {{ t("force_to_mono_voice_desc") }}
                    </div>
                </div>
                <Switch :checked="preferenceStore.forceToMono"
                    @update:checked="(x) => preferenceStore.forceToMono = x" />
            </div>
        </div>
        <br />
        <div class="space-y-4">
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        {{ t("echo_cancellation") }}
                    </div>
                    <div class="text-sm text-muted-foreground">
                        {{ t("echo_cancellation_desc") }}
                    </div>
                </div>
                <Switch :checked="preferenceStore.echoCancellation"
                    @update:checked="(x) => preferenceStore.echoCancellation = x" />
            </div>

            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        AGC
                    </div>
                    <div class="text-sm text-muted-foreground">
                        {{ t("agc_desc") }}
                    </div>
                </div>
                <Switch :checked="preferenceStore.autoGainControl"
                    @update:checked="(x) => preferenceStore.autoGainControl = x" />
            </div>

            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        {{ t("voice_isolation") }}
                    </div>
                    <div class="text-sm text-muted-foreground">
                        {{ t("voice_isolation_desc") }}
                    </div>
                </div>
                <Switch :checked="preferenceStore.voiceIsolation"
                    @update:checked="(x) => preferenceStore.voiceIsolation = x" />
            </div>

            <div class="flex flex-row items-center justify-between rounded-lg border p-4"
                :disabled="preferenceStore.voiceIsolation">
                <div class="space-y-0.5">
                    <div class="text-base">
                        {{ t("noise_sup") }}
                    </div>
                    <div class="text-sm text-muted-foreground">
                        {{ t("noise_sup_desc") }}
                    </div>
                </div>
                <Switch @update:checked="(x) => preferenceStore.noiseSuppression = x"
                    :disabled="preferenceStore.voiceIsolation" :checked="preferenceStore.noiseSuppression" />
            </div>
        </div>
        <br />
        <br />
        <div>
            <label class="block font-semibold mb-1">{{ t("select_camera") }}</label>
            <Select v-model="selectedCamera" @change="updateVideoStream" :disabled="videoDevices.length == 0">
                <SelectTrigger>
                    <SelectValue :placeholder="t('no_camera_found')" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup v-for="device in videoDevices.filter(q => !!q.deviceId)" :key="device.deviceId"
                        :value="device.deviceId">
                        <SelectItem :value="device.deviceId">
                            {{ device.label || t('unnamed_camera') }}
                        </SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>
        </div>
        <br />
        <div class="cameraWrapper">
            <div v-if="!videoActive" class="previewImage">
                <Button @click="startVideoPreview" :disabled="videoDevices.length == 0" style="width: 250px;">
                    {{ t("test_camera") }}
                </Button>
            </div>
            <div v-else class="camera">
                <video ref="videoElement" autoplay playsinline class="media-engine-video"></video>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { usePreference } from '@/store/preferenceStore';
import { logger } from '@/lib/logger';
import Switch from '../ui/switch/Switch.vue';
import { useLocale } from '@/store/localeStore';
const { t } = useLocale();

const preferenceStore = usePreference();
const selectedMicrophone = ref('');
const selectedCamera = ref('');
const audioDevices = ref([] as MediaDeviceInfo[]);
const videoDevices = ref([] as MediaDeviceInfo[]);
const videoStream = ref<MediaStream | null>(null);
const videoElement = ref<HTMLVideoElement | null>(null);
const videoActive = ref(false);
const loaded = ref(false);





const getDevices = async () => {

    watch(selectedMicrophone, () => {
        preferenceStore.defaultAudioDevice = selectedMicrophone.value;
        logger.log("updateSelectedMicrophone", selectedMicrophone.value);
    })

    const devices = await navigator.mediaDevices.enumerateDevices();
    audioDevices.value = devices.filter(q => !!q.deviceId).filter(device => device.kind === 'audioinput');
    videoDevices.value = devices.filter(q => !!q.deviceId).filter(device => device.kind === 'videoinput');


    logger.log(preferenceStore);

    if (preferenceStore.defaultAudioDevice) {
        if (devices.filter(q => q.deviceId === preferenceStore.defaultAudioDevice)) {
            selectedMicrophone.value = preferenceStore.defaultAudioDevice;
        } else {
            preferenceStore.defaultAudioDevice = "";
        }
    } else if (audioDevices.value.length) selectedMicrophone.value = audioDevices.value[0].deviceId ?? "unknown driver";

    if (preferenceStore.defaultVideoDevice) {
        if (devices.filter(q => q.deviceId === preferenceStore.defaultVideoDevice)) {
            selectedCamera.value = preferenceStore.defaultVideoDevice;
        } else {
            preferenceStore.defaultVideoDevice = "";
        }
    }
    else if (videoDevices.value.length) selectedCamera.value = videoDevices.value[0].deviceId ?? "unknown driver";
    loaded.value = true;
};

const startVideoPreview = async () => {
    await updateVideoStream();
    videoActive.value = true;
};


const updateVideoStream = async () => {
    preferenceStore.defaultVideoDevice = selectedCamera.value;
    if (videoStream.value) {
        videoStream.value.getTracks().forEach(track => track.stop());
    }
    try {
        videoStream.value = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: selectedCamera.value } }
        });
        setTimeout(() => {
            videoElement.value!.srcObject = videoStream.value;
        }, 350);
    } catch (error) {
        console.error('Error accessing video stream:', error);
    }
};

onBeforeUnmount(() => {
    if (videoStream.value) {
        videoStream.value.getTracks().forEach(track => track.stop());
    }
});

onMounted(getDevices);
</script>

<style scoped>
.cameraWrapper {
    position: relative;
    background-color: var(--background-secondary, #161616);
    border: 1px solid var(--background-tertiary, #40444b);
    border-radius: 8px;
    width: 100%;
    min-height: 220px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}

.previewImage {
    display: flex;
    align-items: center;
    justify-content: center;
}

.camera {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
}

.media-engine-video {
    width: 100%;
    max-height: 450px;
    aspect-ratio: 16 / 9;
}

.audio-preview {
    margin-top: 16px;
}

.audio-progress {
    height: 10px;
    border-radius: 5px;
    background-color: var(--background-tertiary, #40444b);
}
</style>
