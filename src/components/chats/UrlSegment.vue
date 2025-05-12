<template>
    <a class="text-blue-600 cursor-pointer font-semibold after:text-sm after:font-bold after:content-['_↗'] hover:text-blue-500" @click="onClickUrl">{{ props.entity.Domain
    }}</a>
</template>
<script setup lang="ts" generic="T extends IMessageEntityUrl">
import { useToast } from '../ui/toast';

const props = defineProps<{
    entity: T,
    text: string
}>();
const { toast } = useToast();
const isArgonDomain = (host: string) => /^([a-z0-9-]+\.)*argon\.gl$/i.test(host) || /^([a-z0-9-]+\.)*argon\.zone$/i.test(host);
const onClickUrl = () => {
    const fullyUrl = `https://${props.entity.Domain}${props.entity.Path}`;
    if (isArgonDomain(props.entity.Domain)) {
        if (argon.isArgonHost)
            window.open(fullyUrl, '_blank', 'noopener');
        else
            native.openUrl(fullyUrl);
        return;
    }
    else {
        toast({
            title: `Cannot be open '${fullyUrl}'`,
            variant: "destructive",
            duration: 2500,
        });
    }
};

</script>