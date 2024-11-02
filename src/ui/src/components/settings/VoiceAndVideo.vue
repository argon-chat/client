<template>
    <div>
        <h2 class="text-xl font-bold mb-4">Voice & Video Settings</h2>

        <div>
            <label class="block font-semibold mb-1">Select Microphone</label>
            <Select v-model="selectedMicrophone" @change="updateSelectedMicrophone">
                <SelectTrigger>
                    <SelectValue placeholder="Select a fruit" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup v-for="device in audioDevices" :key="device.deviceId" :value="device.deviceId">
                        <SelectItem :value="device.deviceId">
                            {{ device.label || 'Unnamed Microphone' }}
                        </SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>
        </div>

        <div>
            <label class="block font-semibold mb-1">Select Camera</label>
            <Select v-model="selectedCamera" @change="updateVideoStream">
                <SelectTrigger>
                    <SelectValue placeholder="Select a fruit" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup v-for="device in videoDevices" :key="device.deviceId" :value="device.deviceId">
                        <SelectItem :value="device.deviceId">
                            {{ device.label || 'Unnamed Camera' }}
                        </SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>
        </div>
        <br/>
        <div class="cameraWrapper">
            <div v-if="!videoActive" class="previewImage">
                <Button @click="startVideoPreview">Test Video</Button>
            </div>
            <div v-else class="camera">
                <video ref="videoElement" autoplay playsinline class="media-engine-video"></video>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'

const selectedMicrophone = ref('');
const selectedCamera = ref('');
const audioDevices = ref([] as MediaDeviceInfo[]);
const videoDevices = ref([] as MediaDeviceInfo[]);
const videoStream = ref<MediaStream | null>(null);
const videoElement = ref<HTMLVideoElement | null>(null);
const videoActive = ref(false);

const getDevices = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    audioDevices.value = devices.filter(device => device.kind === 'audioinput');
    videoDevices.value = devices.filter(device => device.kind === 'videoinput');
    if (audioDevices.value.length) selectedMicrophone.value = audioDevices.value[0].deviceId;
    if (videoDevices.value.length) selectedCamera.value = videoDevices.value[0].deviceId;
};

const startVideoPreview = async () => {
    await updateVideoStream();
    videoActive.value = true;
};


const updateVideoStream = async () => {
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
const updateSelectedMicrophone = async () => {

}


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
