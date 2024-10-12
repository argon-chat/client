import { defineStore } from 'pinia';

export const useMediaStore = defineStore('media', {
  state: () => ({
    localStream: null as MediaStream | null,
    remoteStreams: [] as MediaStream[],
  }),
  actions: {
    setLocalStream(stream: MediaStream) {
      this.localStream = stream;
    },
    addRemoteStream(stream: MediaStream) {
      this.remoteStreams.push(stream);
    }
  },
});