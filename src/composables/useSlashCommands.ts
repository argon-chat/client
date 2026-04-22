import { ref, type Ref } from "vue";
import { useApi } from "@/store/system/apiStore";
import { logger } from "@argon/core";
import type { SpaceCommand } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";

const commandCache = new Map<string, { commands: SpaceCommand[]; fetchedAt: number }>();
const CACHE_TTL = 60_000; // 1 minute

export function useSlashCommands(spaceId: () => Guid | undefined) {
  const api = useApi();
  const commands: Ref<SpaceCommand[]> = ref([]);
  const isLoading = ref(false);

  async function fetchCommands(): Promise<SpaceCommand[]> {
    const sid = spaceId();
    if (!sid) return [];

    const cached = commandCache.get(sid);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      commands.value = cached.commands;
      return cached.commands;
    }

    isLoading.value = true;
    try {
      const result = await api.botManagementInteraction.GetSpaceCommands(sid);
      const cmds = [...result];
      commandCache.set(sid, { commands: cmds, fetchedAt: Date.now() });
      commands.value = cmds;
      return cmds;
    } catch (error) {
      logger.error("Failed to fetch slash commands:", error);
      return [];
    } finally {
      isLoading.value = false;
    }
  }

  function invalidateCache() {
    const sid = spaceId();
    if (sid) commandCache.delete(sid);
  }

  function filterCommands(query: string): SpaceCommand[] {
    if (!query) return commands.value;
    const q = query.toLowerCase();
    return commands.value.filter(
      (cmd) => cmd.name.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q),
    );
  }

  return {
    commands,
    isLoading,
    fetchCommands,
    invalidateCache,
    filterCommands,
  };
}
