<script setup lang="ts">
import UserAuthForm from '@/components/UserAuthForm.vue'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { onMounted, ref } from 'vue';

onMounted(() => {
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
    <div
        class="container relative hidden h-screen flex-col items-center justify-center md:grid lg:max-w-none lg:grid-cols-2 lg:px-0">
        <!-- <a href="/examples/authentication" :class="cn(
            buttonVariants({ variant: 'ghost' }),
            'absolute right-4 top-4 md:right-8 md:top-8',
        )">
            Login
        </a>-->
        <div class="relative hidden h-full flex-col bg-muted p-10 text-white dark:border-r lg:flex">
            <div class="absolute inset-0 bg-zinc-900" id="background" style="
            background-image: url(https://i.pinimg.com/originals/69/a4/da/69a4daafa32cc769784b6afba19800f5.jpg);
            background-repeat: no-repeat;
            background-size: cover;
            background-position: center;
            transition: background-position 0.1s ease-out;"/>
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
                        &ldquo;Если намочить руку — то она будет мокрая.&rdquo;
                    </p>
                    <footer class="text-sm">
                        Арам
                    </footer>
                </blockquote>
            </div>
        </div>
        <div class="lg:p-8">
            <div class="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
                <div class="flex flex-col space-y-2 text-center">
                    <h1 class="text-2xl font-semibold tracking-tight">
                        Login into an account
                    </h1>
                    <p class="text-sm text-muted-foreground">
                        Enter your email below to login your account
                    </p>
                </div>
                <UserAuthForm />
                <!-- <p class="px-8 text-center text-sm text-muted-foreground">
                    By clicking continue, you agree to our
                    <a class="underline underline-offset-4 hover:text-primary">
                        Terms of Service
                    </a>
                    and
                    <a href="/privacy" class="underline underline-offset-4 hover:text-primary">
                        Privacy Policy
                    </a>
                    .
                </p>-->
            </div>
        </div>

    </div>
</template>