import { createApp } from 'vue'
import './assets/index.css'
import App from './App.vue'
import { createPinia } from 'pinia'
import router from './router';
import { useGlueStore } from './store/glueStore';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);
const app = createApp(App);
app.use(router)
app.use(pinia);

const glueStore = useGlueStore();

glueStore.initializeGlueRuntime().then(() => {
    app.mount('#app');
});