<template>
    <a class="text-blue-600 cursor-pointer font-semibold after:text-sm after:font-bold after:content-['_↗'] hover:text-blue-500" @click="onClickUrl">{{ props.entity.domain
    }}</a>
</template>
<script setup lang="ts" generic="T extends MessageEntityUrl">
import { MessageEntityUrl } from "@/lib/glue/argonChat";
import { useToast } from "../ui/toast";

const props = defineProps<{
  entity: T;
  text: string;
}>();
const { toast } = useToast();
const isArgonDomain = (host: string) =>
  /^([a-z0-9-]+\.)*argon\.gl$/i.test(host) ||
  /^([a-z0-9-]+\.)*argon\.zone$/i.test(host);
const onClickUrl = () => {
  const fullyUrl = `https://${props.entity.domain}${props.entity.path}`;
  if (isArgonDomain(props.entity.domain)) {
    if (argon.isArgonHost) window.open(fullyUrl, "_blank", "noopener");
    else native.openUrl(fullyUrl);
    return;
  }
  toast({
    title: `Cannot be open '${fullyUrl}'`,
    variant: "destructive",
    duration: 2500,
  });
};
</script>