export const ArgonEntitlementFlags = {
  None: 0n << 0n,
  ViewChannel: 1n << 0n,
  ReadHistory: 1n << 1n,
  JoinToVoice: 1n << 2n,

  SendMessages: 1n << 5n,
  SendVoice: 1n << 6n,
  AttachFiles: 1n << 7n,
  AddReactions: 1n << 8n,
  AnyMentions: 1n << 9n,
  MentionEveryone: 1n << 10n,
  ExternalEmoji: 1n << 11n,
  ExternalStickers: 1n << 12n,
  UseCommands: 1n << 13n,
  PostEmbeddedLinks: 1n << 14n,

  Connect: 1n << 20n,
  Speak: 1n << 21n,
  Video: 1n << 22n,
  Stream: 1n << 23n,

  UseASIO: 1n << 30n,
  AdditionalStreams: 1n << 31n,

  DisconnectMember: 1n << 40n,
  MoveMember: 1n << 41n,
  BanMember: 1n << 42n,
  MuteMember: 1n << 43n,
  KickMember: 1n << 44n,

  ManageChannels: 1n << 50n,
  ManageArchetype: 1n << 51n,
  ManageBots: 1n << 52n,
  ManageEvents: 1n << 53n,
  ManageBehaviour: 1n << 54n,
  ManageServer: 1n << 55n,
  Administrator: 1n << 64n
} as const;

export type ArgonEntitlementFlag = keyof typeof ArgonEntitlementFlags;

export interface ArgonEntitlementFlagDefinition {
  value: bigint;
  i18nKey: string;
}

export interface ArgonEntitlementGroup {
  i18nKey: string;
  flags: ArgonEntitlementFlagDefinition[];
}

export function extractEntitlements(entitlements: bigint): ArgonEntitlementFlag[] {
  const result: ArgonEntitlementFlag[] = [];

  for (const [name, value] of Object.entries(ArgonEntitlementFlags)) {
    if ((entitlements & value) !== 0n) {
      result.push(name as ArgonEntitlementFlag);
    }
  }

  return result;
}

export function extractEntitlementStrict(entitlements: bigint): ArgonEntitlementFlag {
  for (const [name, value] of Object.entries(ArgonEntitlementFlags)) {
    if ((entitlements & value) !== 0n) {
      return name as ArgonEntitlementFlag;
    }
  }
  return "None";
}

export const ArgonEntitlementGroups: ArgonEntitlementGroup[] = [
  {
    i18nKey: "permissions.groups.basic",
    flags: [
      { value: ArgonEntitlementFlags.ViewChannel, i18nKey: "permissions.flags.ViewChannel" },
      { value: ArgonEntitlementFlags.ReadHistory, i18nKey: "permissions.flags.ReadHistory" }
    ]
  },
  {
    i18nKey: "permissions.groups.messaging",
    flags: [
      { value: ArgonEntitlementFlags.SendMessages, i18nKey: "permissions.flags.SendMessages" },
      { value: ArgonEntitlementFlags.AttachFiles, i18nKey: "permissions.flags.AttachFiles" },
      { value: ArgonEntitlementFlags.AddReactions, i18nKey: "permissions.flags.AddReactions" },
      { value: ArgonEntitlementFlags.AnyMentions, i18nKey: "permissions.flags.AnyMentions" },
      { value: ArgonEntitlementFlags.MentionEveryone, i18nKey: "permissions.flags.MentionEveryone" },
      { value: ArgonEntitlementFlags.ExternalEmoji, i18nKey: "permissions.flags.ExternalEmoji" },
      { value: ArgonEntitlementFlags.ExternalStickers, i18nKey: "permissions.flags.ExternalStickers" },
      { value: ArgonEntitlementFlags.UseCommands, i18nKey: "permissions.flags.UseCommands" },
      { value: ArgonEntitlementFlags.PostEmbeddedLinks, i18nKey: "permissions.flags.PostEmbeddedLinks" },
      { value: ArgonEntitlementFlags.SendVoice, i18nKey: "permissions.flags.SendVoice" }
    ]
  },
  {
    i18nKey: "permissions.groups.voice",
    flags: [
      { value: ArgonEntitlementFlags.Connect, i18nKey: "permissions.flags.Connect" },
      { value: ArgonEntitlementFlags.Speak, i18nKey: "permissions.flags.Speak" },
      { value: ArgonEntitlementFlags.Video, i18nKey: "permissions.flags.Video" },
      { value: ArgonEntitlementFlags.Stream, i18nKey: "permissions.flags.Stream" },
      { value: ArgonEntitlementFlags.UseASIO, i18nKey: "permissions.flags.UseASIO" },
      { value: ArgonEntitlementFlags.AdditionalStreams, i18nKey: "permissions.flags.AdditionalStreams" }
    ]
  },
  {
    i18nKey: "permissions.groups.moderation",
    flags: [
      { value: ArgonEntitlementFlags.DisconnectMember, i18nKey: "permissions.flags.DisconnectMember" },
      { value: ArgonEntitlementFlags.MoveMember, i18nKey: "permissions.flags.MoveMember" },
      { value: ArgonEntitlementFlags.MuteMember, i18nKey: "permissions.flags.MuteMember" },
      { value: ArgonEntitlementFlags.KickMember, i18nKey: "permissions.flags.KickMember" },
      { value: ArgonEntitlementFlags.BanMember, i18nKey: "permissions.flags.BanMember" }
    ]
  },
  {
    i18nKey: "permissions.groups.management",
    flags: [
      { value: ArgonEntitlementFlags.ManageChannels, i18nKey: "permissions.flags.ManageChannels" },
      { value: ArgonEntitlementFlags.ManageArchetype, i18nKey: "permissions.flags.ManageArchetype" },
      { value: ArgonEntitlementFlags.ManageBots, i18nKey: "permissions.flags.ManageBots" },
      { value: ArgonEntitlementFlags.ManageEvents, i18nKey: "permissions.flags.ManageEvents" },
      { value: ArgonEntitlementFlags.ManageBehaviour, i18nKey: "permissions.flags.ManageBehaviour" },
      { value: ArgonEntitlementFlags.ManageServer, i18nKey: "permissions.flags.ManageServer" }
    ]
  }
];

(window as any)["extractEntitlements"] = extractEntitlements;