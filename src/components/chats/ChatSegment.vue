<template>
    <MentionSegment v-if="props.entity && isMentionEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <MassMentionSegment v-else-if="props.entity && isMassMentionEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <CustomEmojiSegment v-else-if="props.entity && isCustomEmojiEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <!-- Styles: a custom emoji inside one comes as `children`, drawn in the style's slot. -->
    <component :is="styleSegment" v-else-if="props.entity && styleSegment" :entity="props.entity" :text="props.text">
        <template v-if="props.children?.length" #default>
            <ChatSegment
                v-for="(child, i) in props.children"
                :key="i"
                :entity="child.entity"
                :text="child.text"
                @unsupported="emits('unsupported')"
            />
        </template>
    </component>
    <HashTagSegment v-else-if="props.entity && isHashtagEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <MonospaceSegment v-else-if="props.entity && isMonospaceEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <FractionSegment v-else-if="props.entity && isFractionEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <OrdinalSegment v-else-if="props.entity && isOrdinalEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <UrlSegment v-else-if="props.entity && isUrlEntity(props.entity)" :entity="props.entity" :text="props.text" />
    <template v-else-if="props.entity && throwIsNotSupported()"></template>
    <EmojiText v-else :text="props.text" />
</template>
<script setup lang="ts" generic="T extends IMessageEntity">
import { computed, type Component } from "vue";
import { EntityType, IMessageEntity, MessageEntityCustomEmoji, MessageEntityHashTag, MessageEntityMention, MessageEntityUrl } from "@argon/glue";
import type { IFrag } from "@/composables/useMessageContent";
import BoldSegment from "./BoldSegment.vue";
import CustomEmojiSegment from "./CustomEmojiSegment.vue";
import EmojiText from "./EmojiText";
import CapitalizedSegment from "./CapitalizedSegment.vue";
import FractionSegment from "./FractionSegment.vue";
import HashTagSegment from "./HashTagSegment.vue";
import ItalicSegment from "./ItalicSegment.vue";
import MentionSegment from "./MentionSegment.vue";
import MassMentionSegment from "./MassMentionSegment.vue";
import MonospaceSegment from "./MonospaceSegment.vue";
import OrdinalSegment from "./OrdinalSegment.vue";
import SpoilerSegment from "./SpoilerSegment.vue";
import StrikethroughSegment from "./StrikethroughSegment.vue";
import UnderlineSegment from "./UnderlineSegment.vue";
import UrlSegment from "./UrlSegment.vue";
import { logger } from "@argon/core";

const props = defineProps<{
  entity?: T;
  text: string;
  children?: IFrag[];
}>();

const emits = defineEmits<(e: "unsupported") => void>();

const STYLE_SEGMENTS: Partial<Record<EntityType, Component>> = {
  [EntityType.Bold]: BoldSegment,
  [EntityType.Underline]: UnderlineSegment,
  [EntityType.Italic]: ItalicSegment,
  [EntityType.Strikethrough]: StrikethroughSegment,
  [EntityType.Spoiler]: SpoilerSegment,
  [EntityType.Capitalized]: CapitalizedSegment,
};

const styleSegment = computed(() => (props.entity ? STYLE_SEGMENTS[props.entity.type] ?? null : null));

function isCustomEmojiEntity(entity: IMessageEntity): entity is MessageEntityCustomEmoji {
  return entity.type === EntityType.CustomEmoji;
}

function throwIsNotSupported() {
  logger.warn("Message entity type not supported:", props.entity);
  emits("unsupported");
  return true;
}

function isMentionEntity(
  entity: IMessageEntity,
): entity is MessageEntityMention {
  return entity.type === EntityType.Mention;
}
function isMassMentionEntity(entity: IMessageEntity): entity is IMessageEntity {
  return entity.type === EntityType.MentionEveryone || entity.type === EntityType.MentionRole;
}
function isMonospaceEntity(entity: IMessageEntity): entity is IMessageEntity {
  return entity.type === EntityType.Monospace;
}
function isHashtagEntity(
  entity: IMessageEntity,
): entity is MessageEntityHashTag {
  return entity.type === EntityType.Hashtag;
}
function isOrdinalEntity(entity: IMessageEntity): entity is IMessageEntity {
  return entity.type === EntityType.Ordinal;
}
function isFractionEntity(entity: IMessageEntity): entity is IMessageEntity {
  return entity.type === EntityType.Fraction;
}
function isUrlEntity(entity: IMessageEntity): entity is MessageEntityUrl {
  return entity.type === EntityType.Url;
}
</script>