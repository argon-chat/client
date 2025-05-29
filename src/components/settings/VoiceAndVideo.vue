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
                            {{  device.deviceId == 'default' ? ((device.label.trimStart().replace(/^-/, "") || 'Unnamed Microphone') + '🔸') : (device.label || 'Unnamed Microphone') }}
                        </SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>
            <br />

            <div class="mt-4">
                <div class="flex" style="align-items: anchor-center;">
                    <div class="space-y-1 w-full">
                        <div class="text-xs text-muted-foreground">Left</div>
                        <div class="w-full h-3 bg-[#1a1a1a] h-[0.2rem] rounded overflow-hidden transition-colors">
                            <div class="h-full duration-75 transition-colors"
                                :style="{ width: leftVolume + '%', backgroundColor: audio.volumeColor(leftVolume) }">
                            </div>
                        </div>

                        <div class="w-full h-3 bg-[#1a1a1a] h-[0.2rem] rounded overflow-hidden transition-colors">
                            <div class="h-full duration-75 transition-colors"
                                :style="{ width: rightVolume + '%', backgroundColor: audio.volumeColor(rightVolume) }">
                            </div>
                        </div>
                        <div class="text-xs text-muted-foreground">Right</div>
                    </div>
                    <Button @click="isMonitoring = !isMonitoring" variant="outline" size="icon">
                        <BeanIcon v-if="!isMonitoring" />
                        <BeanOffIcon v-if="isMonitoring" />
                    </Button>

                </div>
            </div>
            <br />

            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        {{ t("force_to_mono_voice") }}
                    </div>
                    <div class="text-sm text-muted-foreground">
                        {{ t("force_to_mono_voice_desc") }}
                    </div>
                </div>
                <Switch :checked="preferenceStore.forceToMono" @update:checked="onChangeForceToMono" />
            </div>
            <br />
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
                <Switch disabled @update:checked="(x) => preferenceStore.noiseSuppression = x"
                    :checked="preferenceStore.noiseSuppression" />
            </div>
        </div>
        <br />
        <br />
        <div>
            <label class="block font-semibold mb-1">{{ t("select_output") }}</label>
            <Select v-model="selectedAudioOutput">
                <SelectTrigger>
                    <SelectValue :placeholder="t('no_speakers_found')" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup v-for="device in audioOutputs.filter(q => !!q.deviceId)" :key="device.deviceId"
                        :value="device.deviceId">
                        <SelectItem :value="device.deviceId">
                            {{ device.deviceId == 'default' ? ((device.label.trimStart().replace(/^-/, "") || t('unnamed_speaker')) + '🔸') : (device.label || t('unnamed_speaker')) }}
                        </SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>
        </div>
        <br />
        <br />
        <div v-if="false">
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
        <div class="cameraWrapper" v-if="false">
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
import { ref, onMounted, onBeforeUnmount, watch, onUnmounted } from 'vue';
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
import Switch from '../ui/switch/Switch.vue';
import { useLocale } from '@/store/localeStore';
import { BeanIcon, BeanOffIcon } from 'lucide-vue-next'
import { audio } from '@/lib/audio/AudioManager';
import { logger } from '@/lib/logger';
import { worklets } from '@/lib/audio/WorkletBase';
import { DisposableBag } from '@/lib/disposables';
const { t } = useLocale();

const preferenceStore = usePreference();
const selectedMicrophone = ref(""); // audio.getInputDevice()
const selectedAudioOutput = ref(""); // audio.getOutputDevice()
const selectedCamera = ref('');
const audioDevices = ref([] as MediaDeviceInfo[]);
const videoDevices = ref([] as MediaDeviceInfo[]);
const audioOutputs = ref<MediaDeviceInfo[]>([]);
const videoStream = ref<MediaStream | null>(null);
const videoElement = ref<HTMLVideoElement | null>(null);
const videoActive = ref(false);
const loaded = ref(false);

const startVideoPreview = async () => {
    await updateVideoStream();
    videoActive.value = true;
};

watch(selectedAudioOutput, async (x) => {
    logger.info("selectedAudioOutput ", x);
    //await (audio.getCurrentAudioContext() as any).setSinkId(x);
})

const updateVideoStream = async () => {
    /*preferenceStore.defaultVideoDevice = selectedCamera.value;
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
    }*/
};

onBeforeUnmount(() => {
    if (videoStream.value) {
        videoStream.value.getTracks().forEach(track => track.stop());
    }
});

onMounted(async () => {
    audioDevices.value = await audio.enumerateDevicesByKind("audioinput");
    videoDevices.value = await audio.enumerateDevicesByKind("videoinput");
    audioOutputs.value = await audio.enumerateDevicesByKind("audiooutput");

    selectedMicrophone.value = audio.getInputDevice().value ?? "default";
    selectedAudioOutput.value = audio.getOutputDevice().value ?? "default";

    loaded.value = true;

    await startMonitoring();
});




const leftVolume = ref(0);
const rightVolume = ref(0);
const isVUMeterEnabled = ref(false);
const isMonitoring = ref(false);

let source: MediaStreamAudioSourceNode | null = null;
let mediaStream: MediaStream | null = null;
let monitoringAudio: HTMLAudioElement | null = null;
const stmNode = ref(null as AudioWorkletNode | null);

async function onChangeForceToMono(x: boolean) {
    preferenceStore.forceToMono = x;
    if (stmNode.value) {
        worklets.setEnabledVUNode(stmNode.value!, x);
    }
}

watch(isVUMeterEnabled, () => {
    leftVolume.value = 0;
    rightVolume.value = 0;
});

watch(isMonitoring, (x) => {
    if (monitoringAudio)
        monitoringAudio.muted = !x;
})


const disposableBag = new DisposableBag();

async function startMonitoring() {
    if (isVUMeterEnabled.value) {
        stopMonitoring();
        return;
    }

    try {
        mediaStream = await audio.createRawInputMediaStream();

        source = audio.getCurrentAudioContext().createMediaStreamSource(mediaStream);

        logger.info("Created media stream, ", mediaStream, source);

        const vuNode = (await worklets.createVUMeter(leftVolume, rightVolume)).injectInto(disposableBag);

        const stm = (await worklets.createStereoToMonoProcessor()).injectInto(disposableBag);

        worklets.setEnabledVUNode(stm, preferenceStore.forceToMono);
        const dest = audio.getCurrentAudioContext().createMediaStreamDestination();

        source.connect(stm);
        stm.connect(dest);
        stm.connect(vuNode);

        stmNode.value = stm;

        monitoringAudio = (await audio.createAudioElement(dest.stream)).injectInto(disposableBag);
        monitoringAudio.muted = !isMonitoring.value;
        isVUMeterEnabled.value = true;
    } catch (err) {
        console.error("Microphone access error:", err);
    }
}
function stopMonitoring() {
    disposableBag.dispose();
    isVUMeterEnabled.value = false;

    source?.disconnect();

    mediaStream?.getTracks().forEach(track => track.stop());

    source = null;
    mediaStream = null;
    stmNode.value = null;

    setTimeout(() => {
        leftVolume.value = 0;
        rightVolume.value = 0;
    }, 50);
}

onUnmounted(() => {
    stopMonitoring();
});
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
