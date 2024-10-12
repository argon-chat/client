<template>
    <div class="video-control">
        <video ref="localVideo" autoplay playsinline class="local-video"></video>
        <div class="controls">
            <label for="videoSource">Video Source</label>
            <select v-model="selectedVideoSource" @change="switchVideoSource" id="videoSource">
                <option v-for="device in videoDevices" :key="device.deviceId" :value="device.deviceId">
                    {{ device.label || 'Camera ' + (videoDevices.indexOf(device) + 1) }}
                </option>
            </select>
        </div>
        <div v-for="(remoteStream, index) in remoteStreams" :key="index" class="remote-video-container">
            <video :ref="setRemoteVideoRef(index)" autoplay playsinline class="remote-video"></video>
        </div>
        <div class="controls">
            <button class="toggle-video-btn" @click="startVideo">Start Video</button>
            <button class="toggle-video-btn" @click="stopVideo">Stop Video</button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, nextTick } from 'vue';
import * as mediasoupClient from 'mediasoup-client';

const localVideo = ref<HTMLVideoElement | null>(null);
const localStream = ref<MediaStream | null>(null);
const remoteStreams = reactive<MediaStream[]>([]);
const videoDevices = ref<MediaDeviceInfo[]>([]);
const selectedVideoSource = ref<string | null>(null);

let device: mediasoupClient.Device;
let sendTransport: mediasoupClient.types.Transport;
let recvTransport: mediasoupClient.types.Transport;

const signalingSocket = new WebSocket('wss://localhost:4443/?roomId=anus&peerId=t1etd8ou&consumerReplicas=undefined', "protoo");

onMounted(async () => {
    await getVideoDevices();

    signalingSocket.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        console.log(event.type);
        switch (data.type) {
            case 'routerRtpCapabilities':
                device = new mediasoupClient.Device();
                await device.load({ routerRtpCapabilities: data.routerRtpCapabilities });
                createTransports();
                break;

            case 'createdTransport':
                if (data.direction === 'send') {
                    sendTransport = device.createSendTransport(data.transportOptions);
                    setupSendTransport();
                } else if (data.direction === 'recv') {
                    recvTransport = device.createRecvTransport(data.transportOptions);
                    setupRecvTransport();
                }
                break;

            case 'connectedTransport':
                break;

            case 'produced':
                break;

            case 'newConsumer':
                await consumeRemoteStream(data.consumerParameters);
                break;
        }
    };
    signalingSocket.send(JSON.stringify({ type: 'getRouterRtpCapabilities' }));
});

const getVideoDevices = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoDevices.value = devices.filter(device => device.kind === 'videoinput');

    if (videoDevices.value.length > 0) {
        selectedVideoSource.value = videoDevices.value[0].deviceId;
    }
};

const switchVideoSource = async () => {
    if (!selectedVideoSource.value) return;

    const constraints = {
        video: { deviceId: { exact: selectedVideoSource.value } },
        audio: true
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStream.value = stream;

    if (localVideo.value && localStream.value) {
        localVideo.value.srcObject = localStream.value;
    }

    if (sendTransport && localStream.value) {
        const videoTrack = localStream.value.getVideoTracks()[0];
        const audioTrack = localStream.value.getAudioTracks()[0];
        await sendTransport.produce({ track: videoTrack });
        await sendTransport.produce({ track: audioTrack });
    }
};

function createTransports() {
    signalingSocket.send(JSON.stringify({ type: 'createWebRtcTransport', direction: 'send' }));
    signalingSocket.send(JSON.stringify({ type: 'createWebRtcTransport', direction: 'recv' }));
}
function setupSendTransport() {
    sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        signalingSocket.send(JSON.stringify({
            type: 'connectTransport',
            transportId: sendTransport.id,
            dtlsParameters,
        }));

        signalingSocket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'connectedTransport' && data.transportId === sendTransport.id) {
                callback();
            }
        };
    });

    sendTransport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
        signalingSocket.send(JSON.stringify({
            type: 'produce',
            transportId: sendTransport.id,
            kind,
            rtpParameters,
        }));

        signalingSocket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'produced') {
                callback({ id: data.producerId });
            }
        };
    });
}

function setupRecvTransport() {
    recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        signalingSocket.send(JSON.stringify({
            type: 'connectTransport',
            transportId: recvTransport.id,
            dtlsParameters,
        }));

        signalingSocket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'connectedTransport' && data.transportId === recvTransport.id) {
                callback();
            }
        };
    });
}
const startVideo = async () => {
    if (!selectedVideoSource.value) return;

    const constraints = {
        video: { deviceId: { exact: selectedVideoSource.value } },
        audio: true
    };

    localStream.value = await navigator.mediaDevices.getUserMedia(constraints);

    if (localVideo.value && localStream.value) {
        localVideo.value.srcObject = localStream.value;
    }

    if (sendTransport && localStream.value) {
        const videoTrack = localStream.value.getVideoTracks()[0];
        const audioTrack = localStream.value.getAudioTracks()[0];

        await sendTransport.produce({ track: videoTrack });
        await sendTransport.produce({ track: audioTrack });
    }
};
const stopVideo = () => {
    localStream.value?.getTracks().forEach((track) => track.stop());
    if (localVideo.value) localVideo.value.srcObject = null;
};
async function consumeRemoteStream(consumerParameters: any) {
    const consumer = await recvTransport.consume({
        id: consumerParameters.id,
        producerId: consumerParameters.producerId,
        kind: consumerParameters.kind,
        rtpParameters: consumerParameters.rtpParameters,
    });

    const remoteStream = new MediaStream([consumer.track]);
    remoteStreams.push(remoteStream);

    signalingSocket.send(JSON.stringify({
        type: 'resumeConsumer',
        consumerId: consumer.id,
    }));
}
const setRemoteVideoRef = (index: number) => (el: HTMLVideoElement | null) => {
    if (el && remoteStreams[index]) {
        el.srcObject = remoteStreams[index];
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
button.toggle-video-btn {
    margin-top: 10px;
    padding: 10px 20px;
    background-color: #7289da;
    border: none;
    border-radius: 5px;
    color: white;
    font-size: 14px;
    cursor: pointer;
}
button.toggle-video-btn:hover {
    background-color: #5a6aa9;
}
</style>