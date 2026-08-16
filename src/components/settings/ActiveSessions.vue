<template>
  <div class="setting-card">
    <div class="flex items-center justify-between gap-2 mb-4">
      <div class="flex items-center gap-2">
        <MonitorSmartphoneIcon class="w-5 h-5 text-primary" />
        <h3 class="text-lg font-semibold">{{ t("sessions_title") }}</h3>
      </div>
      <Button @click="refresh" variant="ghost" size="icon" class="h-8 w-8" :disabled="loading || busy"
        :title="t('sessions_refresh')">
        <RefreshCwIcon class="w-4 h-4" :class="{ 'animate-spin': loading }" />
      </Button>
    </div>

    <p class="text-xs text-muted-foreground mb-4">{{ t("sessions_desc") }}</p>

    <div v-if="loading && sessions.length === 0" class="spinner-container">
      <AtomSpinner class="text-center" />
    </div>

    <!-- The server only reports sessions it currently sees, so an empty list means "nothing is
         signed in right now", not "we failed to ask" — a failed call keeps the previous list. -->
    <div v-else-if="sessions.length === 0" class="text-center py-6 text-sm text-muted-foreground">
      {{ t("sessions_empty") }}
    </div>

    <div v-else class="space-y-2">
      <!-- The raw client string sits in the tooltip: the label below is a guess made from a
           User-Agent, and on a security screen the unguessed original has to stay reachable. -->
      <div v-for="session in sessions" :key="session.sessionId" class="session-row" :title="session.clientName">
        <component :is="clientIcon(session)" class="w-4 h-4 text-muted-foreground shrink-0" />

        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium flex items-center gap-2">
            <span class="truncate">{{ clientLabel(session) }}</span>
            <Badge v-if="session.isCurrent" variant="outline"
              class="bg-green-500/10 text-green-500 border-green-500/30 shrink-0">
              {{ t("sessions_current") }}
            </Badge>
          </div>
          <div class="text-xs text-muted-foreground truncate">
            {{ regionLabel(session) }} · {{ lastSeenLabel(session) }}
          </div>
        </div>

        <!-- No button on the current row: the server answers CANNOT_REVOKE_CURRENT for it, and
             offering an action that is defined to fail is worse than not offering it. -->
        <Button v-if="!session.isCurrent" @click="revoke(session)" variant="ghost" size="sm"
          class="shrink-0 text-red-500 hover:text-red-400" :disabled="busy">
          <Loader2 v-if="revokingId === session.sessionId" class="w-4 h-4 mr-1.5 animate-spin" />
          <LogOutIcon v-else class="w-4 h-4 mr-1.5" />
          {{ t("sessions_signout") }}
        </Button>
      </div>
    </div>

    <div v-if="sessions.length > 1" class="flex items-center justify-between gap-4 mt-4 pt-4 border-t border-border/50">
      <div class="space-y-0.5 min-w-0">
        <div class="text-sm font-medium">{{ t("sessions_signout_others") }}</div>
        <div class="text-xs text-muted-foreground">{{ t("sessions_signout_others_desc") }}</div>
      </div>
      <Button @click="showRevokeAllDialog = true" variant="destructive" size="sm" class="shrink-0" :disabled="busy">
        <Loader2 v-if="revokingAll" class="w-4 h-4 mr-1.5 animate-spin" />
        {{ t("sessions_signout_others_action") }}
      </Button>
    </div>

    <Dialog v-model:open="showRevokeAllDialog">
      <DialogContent class="w-[480px] max-w-[480px]" @interactOutside.prevent>
        <DialogHeader>
          <DialogTitle>{{ t("sessions_signout_others_confirm") }}</DialogTitle>
        </DialogHeader>
        <div class="text-sm text-muted-foreground">
          {{ t("sessions_signout_others_confirm_desc") }}
        </div>
        <DialogFooter>
          <Button @click="showRevokeAllDialog = false" variant="outline">
            {{ t("cancel") }}
          </Button>
          <Button @click="revokeAll" variant="destructive" :disabled="revokingAll">
            {{ t("sessions_signout_others_action") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Badge } from "@argon/ui/badge";
import { Button } from "@argon/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@argon/ui/dialog";
//@ts-ignore
import { AtomSpinner } from "epic-spinners";
import {
  GlobeIcon,
  Loader2,
  LogOutIcon,
  MonitorIcon,
  MonitorSmartphoneIcon,
  RefreshCwIcon,
  SmartphoneIcon,
} from "lucide-vue-next";
import { SessionError, type IRevokeSessionResult, type SessionInfo } from "@argon/glue";
import { useApi } from "@/store/system/apiStore";
import { useLocale } from "@/store/system/localeStore";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";

const { t } = useLocale();
const api = useApi();
const { toast } = useToast();

const sessions = ref<SessionInfo[]>([]);
const loading = ref(false);
const revokingId = ref<string | null>(null);
const revokingAll = ref(false);

const showRevokeAllDialog = ref(false);

const busy = computed(() => revokingId.value !== null || revokingAll.value);

onMounted(refresh);

async function refresh() {
  loading.value = true;
  try {
    const list = await api.securityInteraction.GetSessions();
    sessions.value = [...list];
  } catch (e) {
    // Keep whatever is on screen: replacing a real list with an empty one would read as
    // "you are signed in nowhere else", which is the one wrong thing this screen can say.
    logger.error("failed to load sessions", e);
    toast({ title: t("error"), description: t("sessions_load_failed"), variant: "destructive" });
  } finally {
    loading.value = false;
  }
}

/**
 * Ends one session.
 *
 * The row disappears only after the server confirms it went. Dropping it optimistically would
 * leave the user believing an unrecognised device had been signed out when it had not.
 */
async function revoke(session: SessionInfo) {
  if (busy.value) return;

  revokingId.value = session.sessionId;
  try {
    const result = await api.securityInteraction.RevokeSession(session.sessionId);

    if (result.isSuccessRevokeSession()) {
      sessions.value = sessions.value.filter((x) => x.sessionId !== session.sessionId);
      toast({ title: t("sessions_revoked") });
      return;
    }

    await reportFailure(result);
  } catch (e) {
    logger.error("failed to revoke session", e);
    toast({ title: t("error"), description: t("sessions_revoke_failed"), variant: "destructive" });
  } finally {
    revokingId.value = null;
  }
}

/**
 * Ends every session except this one.
 *
 * The current session survives deliberately — the server spares the caller — so the list is
 * re-read instead of emptied: exactly one row is left afterwards, and showing it is what makes
 * the outcome legible.
 */
async function revokeAll() {
  if (revokingAll.value) return;

  revokingAll.value = true;
  try {
    const result = await api.securityInteraction.RevokeAllSessions();

    if (result.isSuccessRevokeSession()) {
      showRevokeAllDialog.value = false;
      toast({ title: t("sessions_revoked_others") });
      await refresh();
      return;
    }

    await reportFailure(result);
  } catch (e) {
    logger.error("failed to revoke other sessions", e);
    toast({ title: t("error"), description: t("sessions_revoke_failed"), variant: "destructive" });
  } finally {
    revokingAll.value = false;
  }
}

/**
 * Turns a refusal into something the user can act on.
 *
 * NOT_FOUND is the only one that also re-reads the list: the server is saying that session is
 * not there, so the row in front of the user is stale and the honest answer is a fresh list
 * rather than a removed row. The other two leave the list alone — nothing changed server-side.
 */
async function reportFailure(result: IRevokeSessionResult) {
  const error = result.isFailedRevokeSession() ? result.error : SessionError.INTERNAL_ERROR;

  if (error === SessionError.CANNOT_REVOKE_CURRENT) {
    toast({ title: t("error"), description: t("sessions_revoke_current_failed"), variant: "destructive" });
    return;
  }

  if (error === SessionError.NOT_FOUND) {
    toast({ title: t("sessions_revoke_gone") });
    await refresh();
    return;
  }

  toast({ title: t("error"), description: t("sessions_revoke_failed"), variant: "destructive" });
}

// ── Display helpers ───────────────────────────────────────

/**
 * The name a person recognises, guessed off the client string (a User-Agent).
 *
 * Argon's own clients name themselves in it — ArgonChat-Android/… — and everything else is a
 * browser, where the leading token is always "Mozilla" and so tells nobody anything; the browser
 * has to be read out of the middle of the string instead, most specific first, because an Edge
 * agent also says Chrome and a Chrome agent also says Safari. Anything unrecognised falls back to
 * the string itself, which the row truncates and the tooltip shows whole: a bad guess on a
 * security screen costs more than an ugly label.
 */
function clientLabel(session: SessionInfo): string {
  const client = session.clientName.trim();
  if (!client) return t("sessions_unknown_client");

  const own = client.match(/\bArgon[\w.-]*/i);
  if (own) return own[0];

  const browser = [
    { match: /Edg[eA]?\//i, name: "Microsoft Edge" },
    { match: /YaBrowser\//i, name: "Yandex Browser" },
    { match: /OPR\/|Opera\//i, name: "Opera" },
    { match: /Firefox\//i, name: "Firefox" },
    { match: /Chrome\//i, name: "Chrome" },
    { match: /Safari\//i, name: "Safari" },
  ].find((x) => x.match.test(client));

  return browser?.name ?? client;
}

function clientIcon(session: SessionInfo) {
  const client = session.clientName;

  if (/Android|iPhone|iPad/i.test(client)) return SmartphoneIcon;
  if (/Electron|Argon/i.test(client)) return MonitorIcon;
  return GlobeIcon;
}

function regionLabel(session: SessionInfo): string {
  return session.region.trim() || t("sessions_unknown_region");
}

/**
 * How long ago the session was last heard from.
 *
 * Everything listed here is live by definition — the server drops a session shortly after its
 * last heartbeat — so the useful distinction is "right now" against "a couple of minutes ago,
 * about to fall off". The absolute date is only a guard against a clock the client cannot vouch
 * for; in practice it never shows.
 */
function lastSeenLabel(session: SessionInfo): string {
  const lastSeen = session.lastSeenAt.toDate().getTime();
  const minutes = Math.round((Date.now() - lastSeen) / 60000);

  if (minutes < 1) return t("sessions_last_seen_now");
  if (minutes < 60) return t("sessions_last_seen_minutes", { minutes });

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(lastSeen);
}
</script>

<style scoped>
.setting-card {
  border-radius: 0.5rem;
  border: 1px solid hsl(var(--border) / 0.5);
  background-color: hsl(var(--card));
  padding: 1.5rem;
}

.session-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: 0.625rem;
  border: 1px solid hsl(var(--border) / 0.6);
  background: hsl(var(--muted) / 0.25);
}

.spinner-container {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2rem 0;
}
</style>
