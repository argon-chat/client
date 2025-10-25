<template>
    <div class="video-control" style="height: 90vh; margin: 50px;">
        <video ref="localVideo" autoplay playsinline class="local-video"></video>
        <div class="controls">
            <label for="videoSource">{{t("select_video_source")}}:</label>
            <select v-model="selectedVideoSource" @change="switchVideoSource" id="videoSource">
                <option v-for="device in videoDevices" :key="device.deviceId" :value="device.deviceId">
                    {{ device.label || t("camera") + (videoDevices.indexOf(device) + 1) }}
                </option>
            </select>

            <label for="audioSource">{{t("select_audio_source")}}:</label>
            <select v-model="selectedAudioSource" @change="switchAudioSource" id="audioSource">
                <option v-for="device in audioDevices" :key="device.deviceId" :value="device.deviceId">
                    {{ device.label || `${t("microphone")} ${device.deviceId}` }}
                </option>
            </select>
        </div>

        <div v-for="(track, index) in remoteTracks" :key="index" class="remote-video-container">
            <!-- @vue-ignore -->
            <video :ref="setRemoteVideoRef(index)" autoplay playsinline class="remote-video"></video>
        </div>

        <div class="controls" v-if="isConnectedToLive">
            <button class="toggle-video-btn" @click="startVideo">{{t("start_video")}}</button>
            <button class="toggle-video-btn" @click="stopVideo">{{t("stop_video")}}</button>
            <button class="toggle-mute-btn" @click="toggleMute">{{ isMuted ? t("unmute") : t("mute") }}</button>
        </div>

        <div class="controls" v-else>
            <Input id="token" placeholder="token" type="text" v-model="tokenRef" />
            <UiButton @click="beginConnect">
               {{t("signin") }}
            </UiButton>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { Room, LocalVideoTrack, LocalAudioTrack, Track } from "livekit-client";
import { useLocale } from "@/store/localeStore";

const { t } = useLocale();
import UiButton from "./ui/button/Button.vue";
import Input from "./ui/input/Input.vue";

const localVideo = ref<HTMLVideoElement | null>(null);
const localStream = ref<MediaStream | null>(null);
const remoteTracks = reactive<Track[]>([]);
const room = ref<Room | null>(null);
const isMuted = ref(false);
const isConnectedToLive = ref(false);
const tokenRef = ref("");

const selectedAudioSource = ref<string>("");
const selectedVideoSource = ref<string | null>(null);

const audioDevices = ref<MediaDeviceInfo[]>([]);
const videoDevices = ref<MediaDeviceInfo[]>([]);

onMounted(() => {
  getDevices();
});

async function beginConnect() {
  room.value = new Room();
  await room.value.connect(
    "wss://argon-f14ic5ia.livekit.cloud",
    tokenRef.value,
  );
  isConnectedToLive.value = true;

  room.value.on("trackSubscribed", (track, publication, participant) => {
    console.log({ track, publication, participant });
    if (track.kind === Track.Kind.Video) {
      remoteTracks.push(track);
    }
  });

  await startVideo();
}

const getDevices = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  videoDevices.value = devices.filter((device) => device.kind === "videoinput");
  audioDevices.value = devices.filter((device) => device.kind === "audioinput");

  if (videoDevices.value.length && !selectedVideoSource.value) {
    selectedVideoSource.value = videoDevices.value[0].deviceId;
  }
  if (audioDevices.value.length && !selectedAudioSource.value) {
    selectedAudioSource.value = audioDevices.value[0].deviceId;
  }
};

const switchVideoSource = async () => {
  if (!selectedVideoSource.value || !room.value) return;

  const constraints = {
    video: { deviceId: { exact: selectedVideoSource.value } },
    audio: true,
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  localStream.value = stream;

  if (localVideo.value && localStream.value) {
    localVideo.value.srcObject = localStream.value;
  }

  const videoTrack = new LocalVideoTrack(localStream.value.getVideoTracks()[0]);
  await room.value.localParticipant.publishTrack(videoTrack);
};

const switchAudioSource = async () => {
  if (!selectedAudioSource.value || !room.value) return;

  const constraints = {
    audio: { deviceId: { exact: selectedAudioSource.value } },
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const audioTrack = new LocalAudioTrack(stream.getAudioTracks()[0]);

  room.value.localParticipant.unpublishTrack(
    room.value.localParticipant.getTrackPublication(Track.Source.Microphone)
    // @ts-ignore
      ?.track ?? new LocalAudioTrack(),
  );

  await room.value.localParticipant.publishTrack(audioTrack);
};

const startVideo = async () => {
  if (!selectedVideoSource.value || !room.value) return;

  const constraints = {
    video: { deviceId: { exact: selectedVideoSource.value } },
    audio: { deviceId: { exact: selectedAudioSource.value } },
  };

  localStream.value = await navigator.mediaDevices.getUserMedia(constraints);

  if (localVideo.value && localStream.value) {
    localVideo.value.srcObject = localStream.value;
  }

  const videoTrack = new LocalVideoTrack(localStream.value.getVideoTracks()[0]);
  const audioTrack = new LocalAudioTrack(localStream.value.getAudioTracks()[0]);

  await room.value.localParticipant.publishTrack(videoTrack);
  await room.value.localParticipant.publishTrack(audioTrack);
};

const stopVideo = () => {
  const tracks = localStream.value?.getTracks() || [];
  for (const track of tracks) track.stop();
  if (localVideo.value) localVideo.value.srcObject = null;
};

const toggleMute = async () => {
  if (!room.value) return;

  isMuted.value = !isMuted.value;

  const audioTrack = room.value.localParticipant.getTrackPublication(
    Track.Source.Microphone,
  )?.track;
  if (audioTrack) {
    if (isMuted.value) {
      audioTrack.mute();
    } else {
      audioTrack.unmute();
    }
  }
};

const setRemoteVideoRef = (index: number) => (el: HTMLVideoElement | null) => {
  if (el && remoteTracks[index]) {
    el.srcObject = new MediaStream([remoteTracks[index].mediaStreamTrack]);
  }
};
</script>


<style scoped>
.video-control {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    background-color: #2c2f33;
    border-radius: 10px;
    padding: 20px;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
}

.local-video {
    width: 400px;
    height: 300px;
    border-radius: 8px;
    object-fit: cover;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}

.remote-video-container {
    margin-top: 20px;
}

.remote-video {
    width: 100%;
    max-width: 800px;
    border-radius: 10px;
    object-fit: cover;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}

.controls {
    margin-top: 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
}

label {
    font-size: 14px;
    color: white;
    margin-right: 10px;
}

select {
    padding: 5px;
    font-size: 14px;
    background-color: #7289da;
    color: white;
    border-radius: 5px;
    outline: none;
}

button.toggle-video-btn,
button.toggle-mute-btn {
    margin-top: 10px;
    padding: 10px 20px;
    background-color: #7289da;
    border: none;
    border-radius: 5px;
    color: white;
    font-size: 14px;
    cursor: pointer;
}

button.toggle-video-btn:hover,
button.toggle-mute-btn:hover {
    background-color: #5a6aa9;
}
</style>