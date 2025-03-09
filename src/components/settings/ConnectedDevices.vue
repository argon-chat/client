<template>
    <div class="connected-devices p-6 text-white rounded-lg space-y-6">
        <h2 class="text-2xl font-bold">{{ t("connected_devices") }}</h2>

        <div v-for="device in devices" :key="device.id" class="device-item flex items-center justify-between p-4 rounded-md border border-dashed">
            <div>
                <p class="font-semibold">{{ device.name }}</p>
                <p class="text-sm text-gray-300">{{ device.location }}</p>
                <p class="text-xs text-gray-400">{{ device.lastActive }}</p>
            </div>
            <Button @click="logoutDevice(device.id)" variant="outline" size="icon">
                <CirclePower class="text-red-500 hover:text-red-700 w-7 h-7"/>
            </Button>
            
        </div>
        <Button @click="logoutAllDevices" class="button bg-red-500 text-white rounded px-4 py-2 hover:bg-red-600">
            {{ t("logout_all_devices") }}
        </Button>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Button } from '@/components/ui/button/'
import { CirclePower } from 'lucide-vue-next';
import { useLocale } from '@/store/localeStore';
const { t } = useLocale();
const devices = ref([
    { id: 1, name: 'iPhone 12', location: 'New York, USA', lastActive: 'Active 5 minutes ago' },
    { id: 2, name: 'MacBook Pro', location: 'San Francisco, USA', lastActive: 'Active 2 hours ago' },
    { id: 3, name: 'Windows PC', location: 'Los Angeles, USA', lastActive: 'Active yesterday' },
]);

const logoutDevice = (deviceId: number) => {
    const deviceIndex = devices.value.findIndex(device => device.id === deviceId);
    if (deviceIndex !== -1) {
        devices.value.splice(deviceIndex, 1);
        alert(`Logged out from ${devices.value[deviceIndex]?.name || 'the device'}.`);
    }
};

const logoutAllDevices = () => {
    if (confirm('Are you sure you want to log out from all devices?')) {
        devices.value = [];
        alert('Logged out from all devices.');
    }
};
</script>

<style scoped>
.connected-devices {
    max-width: 600px;
    margin: 0 auto;
}

.device-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.button {
    font-size: 1rem;
    font-weight: 500;
    padding: 10px 16px;
}

.button.text-red-500:hover {
    color: #e53e3e;
}
</style>
