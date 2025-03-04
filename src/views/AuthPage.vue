<script setup lang="ts">
import PixelCard from '@/components/PixelCard.vue';
import UserAuthForm from '@/components/UserAuthForm.vue'
import router from '@/router';
import { useAuthStore } from '@/store/authStore';
import { onMounted } from 'vue';
import { useLocale } from '@/store/localeStore';

const { t } = useLocale();


const quotes = [
    { text: "Если намочить руку — то она будет мокрая.", author: "Арам" },
    { text: "А клыки нам даны, чтобы ... кору деревьев отгрызать?", author: "Miniature" },
    { text: "СЫН БЛЯДИ КОНЧЕННЫЙ УЕБОК Я ПО НОРМАЛЬНОМУ СПРОСИЛ БЛЯТЬ", author: "Беляш" },
    { text: "Блядь, ёбанный Юки", author: "Мурзилка" },
    { text: "Ненавижу блять солнце", author: "Юки" }


];
const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
const authStore = useAuthStore();
onMounted(() => {
    if (authStore.isAuthenticated) {
        router.push({ path: "/master.pg" });
        return;
    }
})
</script>

<template>
    <div v-motion-slide-visible-once-top :duration="200" style="overflow: hidden;"
        class="container relative hidden h-screen flex-col items-center justify-center md:grid lg:max-w-none lg:grid-cols-2 lg:px-0" >
        <!-- <a href="/examples/authentication" :class="cn(
            buttonVariants({ variant: 'ghost' }),
            'absolute right-4 top-4 md:right-8 md:top-8',
        )">
            Login
        </a>-->
        <div class="relative hidden h-full flex-col bg-muted p-10 text-white dark:border-r lg:flex">

            <PixelCard class="absolute inset-0 bg-zinc-900 " id="background" style="position: absolute;"/>
            <div class="relative z-20 flex items-center text-lg font-medium">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="mr-2 h-6 w-6">
                    <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
                </svg>
                Argon Chat
            </div>
            <div class="relative z-20 mt-auto">
                <blockquote class="space-y-2">
                    <p class="text-lg">
                        &ldquo;{{ randomQuote.text }}.&rdquo;
                    </p>
                    <footer class="text-sm">
                        {{ randomQuote.author }}
                    </footer>
                </blockquote>
            </div>
        </div>
        <div class="lg:p-8">
            <UserAuthForm />
        </div>

    </div>
</template>
