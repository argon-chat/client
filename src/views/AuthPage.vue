<script setup lang="ts">
import UserAuthForm from '@/components/UserAuthForm.vue'
import router from '@/router';
import { useAuthStore } from '@/store/authStore';
import { onMounted } from 'vue';

const quotes = [
    { text: "Если намочить руку — то она будет мокрая.", author: "Арам" },
    { text: "Попробуй перед сном читать в зеркало заклинание \"завалиебало завалиебало завалиебало\"", author: "Татарин" },
    { text: "Бля я стану самым сильным питон разработчиком. Но пока только читаю резеро.", author: "Баров" },
    { text: "У тебя же нет мамы, прости", author: "Ефим" }
];
const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
const authStore = useAuthStore();
onMounted(() => {
    if (authStore.isAuthenticated) {
        router.push({ path: "/master" });
        return;
    }

    const el = document.querySelector("#background") as any;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    const lerpSpeed = 0.1;
    function animate() {
        currentX += (targetX - currentX) * lerpSpeed;
        currentY += (targetY - currentY) * lerpSpeed;

        el.style.backgroundPosition = `${50 + currentX}% ${50 + currentY}%`;
        requestAnimationFrame(animate);
    }

    document.addEventListener('mousemove', function (e) {
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        targetX = (mouseX / windowWidth - 0.5) * 20;
        targetY = (mouseY / windowHeight - 0.5) * 20;
    });

    animate();
})
</script>

<template>
    <div v-motion-slide-visible-once-top :duration="200"
        class="container relative hidden h-screen flex-col items-center justify-center md:grid lg:max-w-none lg:grid-cols-2 lg:px-0">
        <!-- <a href="/examples/authentication" :class="cn(
            buttonVariants({ variant: 'ghost' }),
            'absolute right-4 top-4 md:right-8 md:top-8',
        )">
            Login
        </a>-->
        <div class="relative hidden h-full flex-col bg-muted p-10 text-white dark:border-r lg:flex">
            <div class="absolute inset-0 bg-zinc-900" id="background" style="
            background-image: url(https://i.pinimg.com/originals/e1/ab/c9/e1abc95c09b5f59ae760038b3be7598c.jpg);
            background-repeat: no-repeat;
            background-size: cover;
            background-position: center;
            transition: background-position 0.1s ease-out;" />
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