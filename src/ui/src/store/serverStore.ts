import { defineStore } from "pinia";
import { computed, ref } from "vue";

interface IServerDefinition {
  id: string;
  name: string;
  icon: string;
}

export const useServerStore = defineStore("server", () => {

  const activeServer = ref({
    serverId: "",
    channelId: ""
  });
  const servers = ref([
      { id: "1", name: 'Server 1', icon: 'https://avatars.githubusercontent.com/u/184695051?s=400&u=e09acb9c913544873a56f64d74b257069bb5ebcf&v=4' }
  ]);
  //const servers = ref([] as IServerDefinition[]);

  const channels = ref([
    { id: 0, name: 'Ебать ваш хуй', type: 'voice', users: [] as {id: number, name: string, avatar: string}[] }
  ]);

  const currentChannel = ref(0);

  function connectTo(id: number) {
    channels.value[id].users.push({ id: 2, name: 'Yuuki Wesp', avatar: 'https://avatars.githubusercontent.com/u/13326808?v=4' })
  }

  const isConnected = ref(false);
  const connectedChannel = computed(() => ({name: channels.value[currentChannel.value].name }));
  const ping = ref("");

  const serverSelected = computed(() => !!activeServer.value.serverId);


  setInterval(() => {
    if (!isConnected.value)
      return;
    ping.value = `${(Math.random() * 100).toFixed(2)}ms`;
  }, 1000);

  return { activeServer, isConnected, connectedChannel, connectTo, ping, servers, serverSelected };
});
