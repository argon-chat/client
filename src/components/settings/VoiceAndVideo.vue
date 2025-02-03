<template>
    <div v-if="loaded">
        <h2 class="text-xl font-bold mb-4">Voice & Video Settings</h2>

        <div>
            <label class="block font-semibold mb-1">Select Microphone</label>
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
        </div>
        <br />
        <div class="space-y-4">


            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        Echo Cancellation
                    </div>
                    <div class="text-sm text-muted-foreground">
                        A feature which attempts to prevent echo effects on a two-way audio connection by attempting
                        to reduce or eliminate crosstalk between the user's output device and their input device
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
                        Is an audio algorithm module that I think has the longest link and most affects sound
                        quality and subjective hearing.
                    </div>
                </div>
                <Switch :checked="preferenceStore.autoGainControl"
                    @update:checked="(x) => preferenceStore.autoGainControl = x" />
            </div>

            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        Voice Isolation
                    </div>
                    <div class="text-sm text-muted-foreground">
                        Isolate Isolation of Isolation Voice for Isolation
                    </div>
                </div>
                <Switch :checked="preferenceStore.voiceIsolation"
                    @update:checked="(x) => preferenceStore.voiceIsolation = x" />
            </div>

            <div class="flex flex-row items-center justify-between rounded-lg border p-4"
                :disabled="preferenceStore.voiceIsolation">
                <div class="space-y-0.5">
                    <div class="text-base">
                        Noise Suppression
                    </div>
                    <div class="text-sm text-muted-foreground">
                        Noise Suppression (Noise Suppression)
                    </div>
                </div>
                <Switch @update:checked="(x) => preferenceStore.noiseSuppression = x"
                    :disabled="preferenceStore.voiceIsolation" :checked="preferenceStore.noiseSuppression" />
            </div>
        </div>
        <br />
        <br />
        <div>
            <label class="block font-semibold mb-1">Select Camera</label>
            <Select v-model="selectedCamera" @change="updateVideoStream" :disabled="videoDevices.length == 0">
                <SelectTrigger>
                    <SelectValue placeholder="No cameras found" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup v-for="device in videoDevices.filter(q => !!q.deviceId)" :key="device.deviceId"
                        :value="device.deviceId">
                        <SelectItem :value="device.deviceId">
                            {{ device.label || 'Unnamed Camera' }}
                        </SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>
        </div>
        <br />
        <div class="cameraWrapper">
            <div v-if="!videoActive" class="previewImage">
                <Button @click="startVideoPreview" :disabled="videoDevices.length == 0" style="width: 250px;">Test
                    Video</Button>
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
import { FormField } from '../ui/form';
import FormItem from '../ui/form/FormItem.vue';
import FormControl from '../ui/form/FormControl.vue';
import Switch from '../ui/switch/Switch.vue';
import FormLabel from '../ui/form/FormLabel.vue';
import FormDescription from '../ui/form/FormDescription.vue';

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
    background-color: var(--background-secondary, #2f3136);
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
