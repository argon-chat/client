<script setup lang="ts">
import Button from "../ui/button/Button.vue";
import Card from "../ui/card/Card.vue";
import CardContent from "../ui/card/CardContent.vue";
import CardFooter from "../ui/card/CardFooter.vue";
import CardHeader from "../ui/card/CardHeader.vue";
import CardTitle from "../ui/card/CardTitle.vue";
import CardDescription from "../ui/card/CardDescription.vue";
import Input from "../ui/input/Input.vue";
import Label from "../ui/label/Label.vue";
import { computed, onMounted, ref, watch } from "vue";
import QRStyled from "./QRStyled.vue";
import { useApi } from "@/store/apiStore";
import { useLocale } from "@/store/localeStore";

const { t } = useLocale();
const props = defineProps<{ auth: ReturnType<typeof import("@/composables/useAuthForm").useAuthForm> }>();
const { email, password, isLoading, goToResetPass, onSubmit } = props.auth;
const api = useApi();
const isMobileDevice = computed(() => argon.isMobileHost);

const titles = [
  { title:t("greetings.good_to_see_you.title"), desc:t("greetings.good_to_see_you.desc")},
  { title:t("greetings.hey_there.title"), desc:t("greetings.hey_there.desc")},
  { title:t("greetings.welcome_back.title"), desc:t("greetings.welcome_back.desc")},
  { title:t("greetings.glad_you_here.title"), desc:t("greetings.glad_you_here.desc")},
  { title:t("greetings.hello_again.title"), desc:t("greetings.hello_again.desc")},
];
const heading = ref(titles[0]);
function pickRandomHeading() {
  heading.value = titles[Math.floor(Math.random() * titles.length)];
}
onMounted(() => pickRandomHeading());

const qrLoginUrl = ref("https://www.youtube.com/watch?v=HIcSWuKMwOw");

const step = ref<"email" | "password">("email");

async function getLoginScenario(email: string): Promise<"pwd" | "otp"> {

  const scenario = await api.identityInteraction.GetAuthorizationScenario();

  console.log("Scenario", scenario);

  if (scenario == "Email_Pwd_Otp") return "pwd";
  if (scenario == "Email_Otp") return "otp";
  return "pwd";
}

async function handleNext() {
  if (!email.value) return;
  const scenario = await getLoginScenario(email.value);


  if (scenario === "pwd") {
    step.value = "password";
  } else if (scenario === "otp") {
    onSubmit();
  }
}

watch(email, (newVal, oldVal) => {
  if (step.value === "password" && newVal !== oldVal) {
    step.value = "email";
  }
});
</script>

<template>
  <div class="flex justify-center items-center min-h-screen">
    <Card
      class="flex flex-row rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl overflow-hidden">
      <form @submit.prevent="onSubmit" class="w-[400px] p-6 flex flex-col">
        <CardHeader class="text-center space-y-1">
          <CardTitle class="text-2xl font-bold text-white">
            {{ heading.title }}
          </CardTitle>
          <CardDescription class="text-gray-400">
            {{ heading.desc }}
          </CardDescription>
        </CardHeader>

        <CardContent class="space-y-4 pt-6 flex-1">
          <div class="space-y-1">
            <div class="flex items-center justify-between">
              <Label for="email" class="text-gray-200">Email</Label>
              <span v-if="step === 'password'" class="text-xs text-gray-400">editing will reset step</span>
            </div>
            <Input id="email" v-model="email" type="email" placeholder="example@email.com" class="h-11 rounded-xl bg-black/50 border-gray-700 text-white placeholder-gray-500
                     focus:border-blue-500 focus:ring focus:ring-blue-500/30" :disabled="isLoading" />
          </div>

          <div v-if="step === 'password'" class="space-y-1">
            <Label for="password" class="text-gray-200">Password</Label>
            <Input id="password" v-model="password" type="password" placeholder="••••••••" class="h-11 rounded-xl bg-black/50 border-gray-700 text-white placeholder-gray-500
                     focus:border-blue-500 focus:ring focus:ring-blue-500/30" :disabled="isLoading" />
            <div class="flex justify-end">
              <a @click="goToResetPass" class="cursor-pointer text-sm text-blue-400 hover:text-blue-300 transition">
                {{ t("forgot_password") }}
              </a>
            </div>
          </div>
        </CardContent>

        <CardFooter class="flex flex-col space-y-2">
          <Button v-if="step === 'email'" type="button" :disabled="isLoading || !email"
            class="w-full hover:opacity-90 transition" @click="handleNext">
            {{ t("next") }}
          </Button>

          <Button v-else type="submit" :disabled="isLoading" class="w-full hover:opacity-90 transition">
            {{ t("signin") }}
          </Button>

          <p class="text-xs text-gray-400 text-center">
            {{t("dont_have_account")}}
            <a @click="props.auth.goToRegister()" class="cursor-pointer text-blue-400 hover:text-blue-300 transition">
              {{ t("create_one") }}
            </a>
          </p>
        </CardFooter>

      </form>

      <div class="w-px bg-white/10"></div>

      <div class="flex flex-col justify-center items-center p-6 w-[250px] text-center space-y-4" v-if="!isMobileDevice">
        <p class="text-gray-300 text-sm">{{t("qr_code_login")}}</p>
        <QRStyled :value="qrLoginUrl" :size="160" level="M" class="rounded-md shadow-lg" />
        <p class="text-xs text-gray-500">{{t("scan_with_app")}}</p>
      </div>
    </Card>
  </div>
</template>
