<script setup lang="ts">
import { ref } from 'vue'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/store/authStore'
import { useRouter } from 'vue-router';
import { useServerStore } from '@/store/serverStore'

const rounter = useRouter();
const server = useServerStore();

const isLoading = ref(false);

const authStore = useAuthStore();
async function onSubmit(event: Event) {
  event.preventDefault()
  isLoading.value = true;

  console.log(event);

  setTimeout(async () => {
    isLoading.value = false;

    await authStore.login("");
    if (server.servers.length == 0) {
      rounter.push({ path: "/create-or-join" })
    }
    else
      rounter.push({ path: "/master" })
  }, 3000)
}
</script>

<template>
  <div :class="cn('grid gap-6', $attrs.class ?? '')">
    <form @submit="onSubmit">
      <div class="grid gap-2">
        <div class="grid gap-1">
          <Label class="sr-only" for="phone">
            Phone
          </Label>
          <Input id="phone" placeholder="+888 8888 88 88" type="phone" auto-capitalize="none" auto-complete="phone"
            auto-correct="off" :disabled="isLoading" />
        </div>
        <Button :disabled="isLoading">
          Sign In with Phone
        </Button>
      </div>
    </form>
  </div>
</template>