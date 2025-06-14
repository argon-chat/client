<template>
    <MentionSegment v-if="props.entity && isMentionEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <BoldSegment v-else-if="props.entity && isBoldEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <HashTagSegment v-else-if="props.entity && isHashtagEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <UnderlineSegment v-else-if="props.entity && isUnderlineEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <MonospaceSegment v-else-if="props.entity && isMonospaceEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <ItalicSegment v-else-if="props.entity && isItalicEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <FractionSegment v-else-if="props.entity && isFractionEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <OrdinalSegment v-else-if="props.entity && isOrdinalEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <UrlSegment v-else-if="props.entity && isUrlEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <template v-else-if="props.entity && throwIsNotSupported()"></template>
    <template v-else>{{ props.text }}</template>
</template>
<script setup lang="ts" generic="T extends IMessageEntity">
import BoldSegment from "./BoldSegment.vue";
import FractionSegment from "./FractionSegment.vue";
import HashTagSegment from "./HashTagSegment.vue";
import ItalicSegment from "./ItalicSegment.vue";
import MentionSegment from "./MentionSegment.vue";
import MonospaceSegment from "./MonospaceSegment.vue";
import OrdinalSegment from "./OrdinalSegment.vue";
import UnderlineSegment from "./UnderlineSegment.vue";
import UrlSegment from "./UrlSegment.vue";

const props = defineProps<{
  entity?: T;
  text: string;
}>();

const emits = defineEmits<(e: "unsupported") => void>();

function throwIsNotSupported() {
  emits("unsupported");
  return true;
}

function isMentionEntity(
  entity: IMessageEntity,
): entity is IMessageEntityMention {
  return entity.Type === "Mention";
}
function isBoldEntity(entity: IMessageEntity): entity is IMessageEntity {
  return entity.Type === "Bold";
}
function isItalicEntity(entity: IMessageEntity): entity is IMessageEntity {
  return entity.Type === "Italic";
}
function isMonospaceEntity(entity: IMessageEntity): entity is IMessageEntity {
  return entity.Type === "Monospace";
}
function isUnderlineEntity(
  entity: IMessageEntity,
): entity is IMessageEntityUnderline {
  return entity.Type === "Underline";
}
function isHashtagEntity(
  entity: IMessageEntity,
): entity is IMessageEntityHashTag {
  return entity.Type === "Hashtag";
}
function isOrdinalEntity(entity: IMessageEntity): entity is IMessageEntity {
  return entity.Type === "Ordinal";
}
function isFractionEntity(entity: IMessageEntity): entity is IMessageEntity {
  return entity.Type === "Fraction";
}
function isUrlEntity(entity: IMessageEntity): entity is IMessageEntityUrl {
  return entity.Type === "Url";
}
</script>