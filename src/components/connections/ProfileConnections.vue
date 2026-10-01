<template>
  <div v-if="items.length > 0" class="profile-connections" data-testid="profile-connections">
    <div class="section-label">{{ t("connections") }}</div>
    <div class="connection-list">
      <component :is="item.url ? 'button' : 'div'" v-for="item in items" :key="item.provider" type="button"
        class="connection-item" :class="{ 'connection-item--link': !!item.url }"
        :title="providerMeta(item.provider)?.name" @click="item.url && openExternalUrl(item.url)">
        <component :is="providerMeta(item.provider)?.icon" class="connection-icon"
          :style="{ color: providerMeta(item.provider)?.color }" />
        <div class="connection-text">
          <div class="connection-name">
            <span class="truncate">{{ item.name }}</span>
            <BadgeCheckIcon v-if="item.verified" class="verified-icon" :title="t('connections_verified')" />
            <ExternalLinkIcon v-if="item.url" class="external-icon" />
          </div>
          <div v-if="facts(item).length > 0" class="connection-facts">{{ facts(item).join(" · ") }}</div>
        </div>
      </component>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ConnectionDetailKind, type ProfileConnection } from "@argon/glue";
import { BadgeCheckIcon, ExternalLinkIcon } from "lucide-vue-next";
import { useLocale } from "@/store/system/localeStore";
import {
  detailSlug,
  formatDetailValue,
  providerMeta,
  sortByProvider,
  visibleDetails,
} from "@/lib/connections/providers";
import { openExternalUrl } from "@/lib/linkPreview/openExternal";

const props = defineProps<{ connections: readonly ProfileConnection[] }>();

const locale = useLocale();
const { t } = locale;

const items = computed(() => sortByProvider(props.connections).filter((c) => providerMeta(c.provider)));

/** "245 games · since Mar 2012": the first three facts, each with its label. */
function facts(item: ProfileConnection): string[] {
  return visibleDetails(item.details)
    .slice(0, 3)
    .map((d) => d.kind === ConnectionDetailKind.FLAG
      ? t(`connection_detail_${detailSlug(d.key)}`)
      : `${t(`connection_detail_${detailSlug(d.key)}`)} ${formatDetailValue(d, locale.currentLocale)}`);
}
</script>

<style scoped>
.profile-connections {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.connection-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.connection-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  padding: 0.4rem 0.5rem;
  border-radius: 0.5rem;
  background: hsl(var(--muted) / 0.35);
  text-align: left;
  min-width: 0;
}

.connection-item--link:hover {
  background: hsl(var(--muted) / 0.6);
}

.connection-icon {
  width: 1.25rem;
  height: 1.25rem;
  flex-shrink: 0;
}

.connection-text {
  min-width: 0;
  flex: 1;
}

.connection-name {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8125rem;
  font-weight: 600;
  min-width: 0;
}

.verified-icon {
  width: 0.875rem;
  height: 0.875rem;
  color: hsl(var(--primary));
  flex-shrink: 0;
}

.external-icon {
  width: 0.75rem;
  height: 0.75rem;
  opacity: 0;
  flex-shrink: 0;
  transition: opacity 0.15s ease;
}

.connection-item--link:hover .external-icon {
  opacity: 0.7;
}

.connection-facts {
  font-size: 0.6875rem;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
