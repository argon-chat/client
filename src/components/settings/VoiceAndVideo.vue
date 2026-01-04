<template>
    <div v-if="loaded" class="space-y-6">
        <h2 class="text-2xl font-bold mb-6">{{ t("voice_video_settings") }}</h2>

        <!-- Микрофон секция -->
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
                    <SelectGroup v-for="device in audioDevices.filter(q => !!q.deviceId)" :key="device.deviceId"
                        :value="device.deviceId">
                        <SelectItem :value="device.deviceId">
                            {{ device.deviceId == 'default' ? ((device.label.trimStart().replace(/^-/, "") || t("noname_microphone")) + ' 🔸') : (device.label || t("noname_microphone")) }}
                        </SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>

            <!-- Volume Meters -->
            <div class="mt-6 p-4 rounded-lg bg-background/50 border">
                <div class="flex items-center justify-between mb-3">
                    <span class="text-sm font-medium flex items-center gap-2">
                        <ActivityIcon class="w-4 h-4" />
                        Input Level
                    </span>
                    <Button 
                        @click="isMonitoring = !isMonitoring" 
                        variant="ghost" 
                        size="sm"
                        class="h-8"
                    >
                        <VolumeIcon v-if="!isMonitoring" class="w-4 h-4" />
                        <VolumeXIcon v-if="isMonitoring" class="w-4 h-4" />
                        <span class="ml-2 text-xs">{{ isMonitoring ? 'Mute' : 'Monitor' }}</span>
                    </Button>
                </div>
                
                <div class="space-y-3">
                    <div class="space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="text-xs text-muted-foreground font-medium">Left Channel</span>
                            <span class="text-xs text-muted-foreground">{{ formatDb(leftDbSmoothed) }} dB</span>
                        </div>
                        <div class="volume-meter">
                            <div 
                                class="volume-fill"
                                :style="{ width: leftVolume + '%', backgroundColor: audio.volumeColor(leftVolume) }"
                            />
                        </div>
                    </div>
                    
                    <div class="space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="text-xs text-muted-foreground font-medium">Right Channel</span>
                            <span class="text-xs text-muted-foreground">{{ formatDb(rightDbSmoothed) }} dB</span>
                        </div>
                        <div class="volume-meter">
                            <div 
                                class="volume-fill"
                                :style="{ width: rightVolume + '%', backgroundColor: audio.volumeColor(rightVolume) }"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <!-- Настройки микрофона -->
            <div class="mt-4 space-y-3">
                <div class="setting-item">
                    <div class="flex-1">
                        <div class="text-sm font-medium">{{ t("force_to_mono_voice") }}</div>
                        <div class="text-xs text-muted-foreground">{{ t("force_to_mono_voice_desc") }}</div>
                    </div>
                    <Switch :checked="preferenceStore.forceToMono" @update:checked="onChangeForceToMono" />
                </div>
                
                <div class="setting-item" :class="{ 'opacity-50': preferenceStore.voiceIsolation }">
                    <div class="flex-1">
                        <div class="text-sm font-medium">{{ t("noise_sup") }}</div>
                        <div class="text-xs text-muted-foreground">{{ t("noise_sup_desc") }}</div>
                    </div>
                    <Switch 
                        disabled 
                        @update:checked="(x) => preferenceStore.noiseSuppression = x"
                        :checked="preferenceStore.noiseSuppression" 
                    />
                </div>
            </div>
        </div>

        <!-- Динамики секция -->
        <div class="setting-card">
            <div class="flex items-center justify-between mb-4">
                <div class="flex items-center gap-2">
                    <SpeakerIcon class="w-5 h-5 text-primary" />
                    <h3 class="text-lg font-semibold">{{ t("select_output") }}</h3>
                </div>
                <Button 
                    @click="playTestSound" 
                    variant="outline" 
                    size="sm"
                    :disabled="!selectedAudioOutput || isPlayingTest"
                    class="h-8"
                >
                    <PlayIcon v-if="!isPlayingTest" class="w-4 h-4 mr-2" />
                    <Loader2Icon v-else class="w-4 h-4 mr-2 animate-spin" />
                    Test Sound
                </Button>
            </div>
            
            <Select v-model="selectedAudioOutput">
                <SelectTrigger class="w-full">
                    <SelectValue :placeholder="t('no_speakers_found')" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup v-for="device in audioOutputs.filter(q => !!q.deviceId)" :key="device.deviceId"
                        :value="device.deviceId">
                        <SelectItem :value="device.deviceId">
                            {{ device.deviceId == 'default' ? ((device.label.trimStart().replace(/^-/, "") || t('unnamed_speaker')) + ' 🔸') : (device.label || t('unnamed_speaker')) }}
                        </SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>
        </div>

        <!-- Камера секция -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <VideoIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t("select_camera") }}</h3>
            </div>
            
            <Select 
                v-model="selectedCamera" 
                @update:modelValue="onCameraChange" 
                :disabled="videoDevices.length == 0"
            >
                <SelectTrigger class="w-full">
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

            <!-- Camera Preview -->
            <Transition name="camera-fade">
                <div v-if="videoActive" class="camera-preview-wrapper">
                    <div class="camera-preview">
                        <video ref="videoElement" autoplay playsinline class="media-engine-video"></video>
                        <div class="camera-overlay">
                            <div class="camera-status">
                                <div class="recording-indicator"></div>
                                <span class="text-xs font-medium">Camera Active</span>
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
            
            <div v-if="videoActive" class="mt-4 flex justify-center gap-2">
                <Button @click="stopVideoPreview" variant="outline">
                    <VideoOffIcon class="w-4 h-4 mr-2" />
                    {{ t("stop_preview") }}
                </Button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { audio } from "@/lib/audio/AudioManager";
import { worklets } from "@/lib/audio/WorkletBase";
import { DisposableBag } from "@/lib/disposables";
import { logger } from "@/lib/logger";
import { useLocale } from "@/store/localeStore";
import { usePreference } from "@/store/preferenceStore";
import { 
  MicIcon, 
  SpeakerIcon, 
  VideoIcon, 
  VideoOffIcon,
  ActivityIcon,
  VolumeIcon,
  VolumeXIcon,
  PlayIcon,
  Loader2Icon
} from "lucide-vue-next";
import { nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from "vue";
import Switch from "../ui/switch/Switch.vue";
const { t } = useLocale();

const preferenceStore = usePreference();
const selectedMicrophone = ref(""); // audio.getInputDevice()
const selectedAudioOutput = ref(""); // audio.getOutputDevice()
const selectedCamera = ref("");
const audioDevices = ref([] as MediaDeviceInfo[]);
const videoDevices = ref([] as MediaDeviceInfo[]);
const audioOutputs = ref<MediaDeviceInfo[]>([]);
const videoStream = ref<MediaStream | null>(null);
const videoElement = ref<HTMLVideoElement | null>(null);
const videoActive = ref(false);
const loaded = ref(false);
const isPlayingTest = ref(false);

const startVideoPreview = async () => {
  try {
    logger.info("Starting video preview, selected camera:", selectedCamera.value);
    logger.info("Available cameras:", videoDevices.value);
    
    if (!selectedCamera.value && videoDevices.value.length > 0) {
      selectedCamera.value = videoDevices.value[0].deviceId;
      logger.info("Auto-selected first camera:", selectedCamera.value);
    }
    
    videoActive.value = true;
    await nextTick();
    
    logger.info("Video element ready:", !!videoElement.value);
    await updateVideoStream();
  } catch (error) {
    logger.error("Failed to start video preview:", error);
    videoActive.value = false;
  }
};

watch(selectedAudioOutput, async (x) => {
  logger.info("selectedAudioOutput ", x);
  //await (audio.getCurrentAudioContext() as any).setSinkId(x);
});
watch(selectedMicrophone, async (x) => {
  logger.info("selectedMicrophone ", x);
  audio.getInputDevice().value = x;
  stopMonitoring();
  startMonitoring();
});

const updateVideoStream = async () => {
  if (!selectedCamera.value) {
    logger.warn("No camera selected");
    return;
  }
  
  logger.info("Updating video stream for camera:", selectedCamera.value);
  
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
    
    logger.info("Requesting camera with constraints:", constraints);
    videoStream.value = await navigator.mediaDevices.getUserMedia(constraints);
    logger.info("Got video stream:", !!videoStream.value, "tracks:", videoStream.value?.getTracks().length);
    
    if (!videoElement.value) {
      logger.error("Video element is null!");
      return;
    }
    
    videoElement.value.srcObject = videoStream.value;
    logger.info("Set srcObject, attempting to play...");
    
    try {
      await videoElement.value.play();
      logger.info("Video playing successfully");
    } catch (playError) {
      logger.warn("Play failed, but video might still work:", playError);
    }
  } catch (error) {
    logger.error('Error accessing video stream:', error);
    throw error;
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

const onCameraChange = async (deviceId: any) => {
  if (videoActive.value && typeof deviceId === 'string') {
    await updateVideoStream();
  }
};

const playTestSound = async () => {
  if (isPlayingTest.value) return;
  
  try {
    isPlayingTest.value = true;
    const audioContext = new AudioContext();
    const masterGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);
    
    // Pleasant chord progression: C -> E -> G
    const notes = [
      { freq: 523.25, start: 0, duration: 0.25 },      // C5
      { freq: 659.25, start: 0.25, duration: 0.25 },   // E5
      { freq: 783.99, start: 0.5, duration: 0.4 }      // G5
    ];
    
    notes.forEach(({ freq, start, duration }) => {
      // Main oscillator with soft timbre
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();
      
      osc.type = 'sine';
      osc.frequency.value = freq;
      
      // Soft low-pass filter for warmth
      filter.type = 'lowpass';
      filter.frequency.value = 2000;
      filter.Q.value = 1;
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);
      
      const startTime = audioContext.currentTime + start;
      const endTime = startTime + duration;
      
      // Smooth envelope
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.15, startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, endTime);
      
      osc.start(startTime);
      osc.stop(endTime);
      
      // Add subtle harmonic for richness
      const harmonic = audioContext.createOscillator();
      const harmonicGain = audioContext.createGain();
      
      harmonic.type = 'sine';
      harmonic.frequency.value = freq * 2;
      harmonic.connect(harmonicGain);
      harmonicGain.connect(masterGain);
      
      harmonicGain.gain.setValueAtTime(0, startTime);
      harmonicGain.gain.linearRampToValueAtTime(0.03, startTime + 0.05);
      harmonicGain.gain.exponentialRampToValueAtTime(0.001, endTime);
      
      harmonic.start(startTime);
      harmonic.stop(endTime);
    });
    
    setTimeout(() => {
      isPlayingTest.value = false;
      audioContext.close();
    }, 1200);
  } catch (error) {
    logger.error('Error playing test sound:', error);
    isPlayingTest.value = false;
  }
};

onBeforeUnmount(() => {
  if (videoStream.value) {
    for (const track of videoStream.value.getTracks()) {
      track.stop();
    }
  }
});

onMounted(async () => {
  audioDevices.value = await audio.enumerateDevicesByKind("audioinput");
  videoDevices.value = await audio.enumerateDevicesByKind("videoinput");
  audioOutputs.value = await audio.enumerateDevicesByKind("audiooutput");

  selectedMicrophone.value = audio.getInputDevice().value ?? "default";
  selectedAudioOutput.value = audio.getOutputDevice().value ?? "default";
  selectedCamera.value = preferenceStore.defaultVideoDevice || (videoDevices.value[0]?.deviceId ?? "");

  loaded.value = true;

  await startMonitoring();
});

const leftVolume = ref(0);
const rightVolume = ref(0);
const isVUMeterEnabled = ref(false);
const isMonitoring = ref(false);

const leftDbSmoothed = ref(0);
const rightDbSmoothed = ref(0);

const percentToDb = (percent: number): number => {
  if (percent <= 0) return -Infinity;
  // Reverse the volumeToPercent transformation: percent = vol^0.3 * 100
  // So: vol = (percent / 100)^(1/0.3)
  const amplitude = Math.pow(percent / 100, 1 / 0.3);
  return 20 * Math.log10(amplitude);
};

const formatDb = (db: number): string => {
  if (!isFinite(db) || db < -60) return '-∞';
  return db.toFixed(1);
};

// Smooth dB values for display
watch([leftVolume, rightVolume], ([left, right]) => {
  const leftDb = percentToDb(left);
  const rightDb = percentToDb(right);
  
  const smoothing = 0.3; // Lower = smoother but slower response
  
  if (!isFinite(leftDbSmoothed.value)) {
    leftDbSmoothed.value = leftDb;
  } else {
    leftDbSmoothed.value = leftDbSmoothed.value + (leftDb - leftDbSmoothed.value) * smoothing;
  }
  
  if (!isFinite(rightDbSmoothed.value)) {
    rightDbSmoothed.value = rightDb;
  } else {
    rightDbSmoothed.value = rightDbSmoothed.value + (rightDb - rightDbSmoothed.value) * smoothing;
  }
});

let source: MediaStreamAudioSourceNode | null = null;
let mediaStream: MediaStream | null = null;
let monitoringAudio: HTMLAudioElement | null = null;
const stmNode = ref(null as AudioWorkletNode | null);

async function onChangeForceToMono(x: boolean) {
  preferenceStore.forceToMono = x;
  if (stmNode.value) {
    worklets.setEnabledVUNode(stmNode.value, x);
  }
}

watch(isVUMeterEnabled, () => {
  leftVolume.value = 0;
  rightVolume.value = 0;
  leftDbSmoothed.value = -Infinity;
  rightDbSmoothed.value = -Infinity;
});

watch(isMonitoring, (x) => {
  if (monitoringAudio) monitoringAudio.muted = !x;
});

const disposableBag = new DisposableBag();

async function startMonitoring() {
  if (isVUMeterEnabled.value) {
    stopMonitoring();
    return;
  }

  try {
    mediaStream = await audio.createRawInputMediaStream();

    source = audio
      .getCurrentAudioContext()
      .createMediaStreamSource(mediaStream);

    logger.info("Created media stream, ", mediaStream, source);

    const vuNode = (
      await worklets.createVUMeter(leftVolume, rightVolume)
    ).injectInto(disposableBag);

    const stm = (await worklets.createStereoToMonoProcessor()).injectInto(
      disposableBag,
    );

    worklets.setEnabledVUNode(stm, preferenceStore.forceToMono);
    const dest = audio.getCurrentAudioContext().createMediaStreamDestination();

    source.connect(stm);
    stm.connect(dest);
    stm.connect(vuNode);

    stmNode.value = stm;

    monitoringAudio = (await audio.createAudioElement(dest.stream)).injectInto(
      disposableBag,
    );
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

  for (const track of mediaStream?.getTracks() ?? []) {
    track.stop();
  }

  source = null;
  mediaStream = null;
  stmNode.value = null;

  setTimeout(() => {
    leftVolume.value = 0;
    rightVolume.value = 0;
    leftDbSmoothed.value = -Infinity;
    rightDbSmoothed.value = -Infinity;
  }, 50);
}

onUnmounted(() => {
  stopMonitoring();
});
</script>

<style scoped>
.setting-card {
    @apply rounded-xl border bg-card p-6 shadow-sm transition-all hover:shadow-md;
}

.setting-item {
    @apply flex items-center justify-between gap-4 p-3 rounded-lg bg-background/30 border transition-colors hover:bg-background/50;
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
