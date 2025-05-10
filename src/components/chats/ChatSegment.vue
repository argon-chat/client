<template>
    <MentionSegment v-if="props.entity && isMentionEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <template v-else>{{ props.text }}</template>
</template>
<script setup lang="ts" generic="T extends IMessageEntity">
import MentionSegment from './MentionSegment.vue';


const props = defineProps<{
    entity?: T,
    text: string
}>();


function isMentionEntity(entity: IMessageEntity): entity is IMessageEntityMention {
    return entity.Type === 'Mention';
}
</script>