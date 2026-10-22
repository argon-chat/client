import type { SpaceCommand } from "@argon/glue";

/** Resolve from the text itself, so pasting and picking a command take the same send path. */
export function resolveSlashCommand(text: string, commands: readonly SpaceCommand[], preferredCommandId?: string) {
  const match = /^\/([\w-]{1,32})(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) return null;
  const matching = commands.filter((candidate) => candidate.name.toLowerCase() === match[1].toLowerCase());
  const cmd = matching.find((candidate) => candidate.commandId === preferredCommandId) ?? matching[0];
  if (!cmd) return null;

  const optionText = (match[2] ?? "").trim();
  const options: { name: string; value: string }[] = [];
  if (optionText && cmd.options?.length === 1) {
    options.push({ name: cmd.options[0].name, value: optionText });
  } else if (optionText && cmd.options?.length) {
    const allowed = new Set(cmd.options.map((option) => option.name));
    for (const part of optionText.matchAll(/(?:^|\s)([\w-]+):("[^"]*"|\S+)/g)) {
      if (allowed.has(part[1])) {
        options.push({ name: part[1], value: part[2].replace(/^"(.*)"$/, "$1") });
      }
    }
  }
  return { cmd, options };
}
