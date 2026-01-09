import { ArgonEntitlement } from "@argon/glue";

export const ArgonEntitlementFlags = {
  None: ArgonEntitlement.None,
  ViewChannel: ArgonEntitlement.ViewChannel,
  ReadHistory: ArgonEntitlement.ReadHistory,
  JoinToVoice: ArgonEntitlement.JoinToVoice,

  SendMessages: ArgonEntitlement.SendMessages,
  SendVoice: ArgonEntitlement.SendVoice,
  AttachFiles: ArgonEntitlement.AttachFiles,
  AddReactions: ArgonEntitlement.AddReactions,
  AnyMentions: ArgonEntitlement.AnyMentions,
  MentionEveryone: ArgonEntitlement.MentionEveryone,
  ExternalEmoji: ArgonEntitlement.ExternalEmoji,
  ExternalStickers: ArgonEntitlement.ExternalStickers,
  UseCommands: ArgonEntitlement.UseCommands,
  PostEmbeddedLinks: ArgonEntitlement.PostEmbeddedLinks,

  Connect: ArgonEntitlement.Connect,
  Speak: ArgonEntitlement.Speak,
  Video: ArgonEntitlement.Video,
  Stream: ArgonEntitlement.Stream,

  UseASIO: ArgonEntitlement.UseASIO,
  AdditionalStreams: ArgonEntitlement.AdditionalStreams,

  DisconnectMember: ArgonEntitlement.DisconnectMember,
  MoveMember: ArgonEntitlement.MoveMember,
  BanMember: ArgonEntitlement.BanMember,
  MuteMember: ArgonEntitlement.MuteMember,
  KickMember: ArgonEntitlement.KickMember,

  ManageChannels: ArgonEntitlement.ManageChannels,
  ManageArchetype: ArgonEntitlement.ManageArchetype,
  ManageBots: ArgonEntitlement.ManageBots,
  ManageEvents: ArgonEntitlement.ManageEvents,
  ManageBehaviour: ArgonEntitlement.ManageBehaviour,
  ManageServer: ArgonEntitlement.ManageServer
} as const;

export type ArgonEntitlementFlag = keyof typeof ArgonEntitlementFlags;

export interface ArgonEntitlementFlagDefinition {
  value: any;
  i18nKey: string;
}

export interface ArgonEntitlementGroup {
  i18nKey: string;
  flags: ArgonEntitlementFlagDefinition[];
}

export function extractEntitlements(
  entitlements: bigint,
): ArgonEntitlementFlag[] {
  const result: ArgonEntitlementFlag[] = [];

  for (const [name, value] of Object.entries(ArgonEntitlementFlags)) {
    // @ts-ignore
    if ((entitlements & value) !== 0n) {
      result.push(name as ArgonEntitlementFlag);
    }
  }
  return result;
}

export function extractEntitlementStrict(
  entitlements: bigint,
): ArgonEntitlementFlag {
  for (const [name, value] of Object.entries(ArgonEntitlementFlags)) {
    // @ts-ignore
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
      {
        value: ArgonEntitlementFlags.ViewChannel,
        i18nKey: "permissions.flags.ViewChannel",
      },
      {
        value: ArgonEntitlementFlags.ReadHistory,
        i18nKey: "permissions.flags.ReadHistory",
      },
    ],
  },
  {
    i18nKey: "permissions.groups.messaging",
    flags: [
      {
        value: ArgonEntitlementFlags.SendMessages,
        i18nKey: "permissions.flags.SendMessages",
      },
      {
        value: ArgonEntitlementFlags.AttachFiles,
        i18nKey: "permissions.flags.AttachFiles",
      },
      {
        value: ArgonEntitlementFlags.AddReactions,
        i18nKey: "permissions.flags.AddReactions",
      },
      {
        value: ArgonEntitlementFlags.AnyMentions,
        i18nKey: "permissions.flags.AnyMentions",
      },
      {
        value: ArgonEntitlementFlags.MentionEveryone,
        i18nKey: "permissions.flags.MentionEveryone",
      },
      {
        value: ArgonEntitlementFlags.ExternalEmoji,
        i18nKey: "permissions.flags.ExternalEmoji",
      },
      {
        value: ArgonEntitlementFlags.ExternalStickers,
        i18nKey: "permissions.flags.ExternalStickers",
      },
      {
        value: ArgonEntitlementFlags.UseCommands,
        i18nKey: "permissions.flags.UseCommands",
      },
      {
        value: ArgonEntitlementFlags.PostEmbeddedLinks,
        i18nKey: "permissions.flags.PostEmbeddedLinks",
      },
      {
        value: ArgonEntitlementFlags.SendVoice,
        i18nKey: "permissions.flags.SendVoice",
      },
    ],
  },
  {
    i18nKey: "permissions.groups.voice",
    flags: [
      {
        value: ArgonEntitlementFlags.Connect,
        i18nKey: "permissions.flags.Connect",
      },
      {
        value: ArgonEntitlementFlags.Speak,
        i18nKey: "permissions.flags.Speak",
      },
      {
        value: ArgonEntitlementFlags.Video,
        i18nKey: "permissions.flags.Video",
      },
      {
        value: ArgonEntitlementFlags.Stream,
        i18nKey: "permissions.flags.Stream",
      },
      {
        value: ArgonEntitlementFlags.UseASIO,
        i18nKey: "permissions.flags.UseASIO",
      },
      {
        value: ArgonEntitlementFlags.AdditionalStreams,
        i18nKey: "permissions.flags.AdditionalStreams",
      },
    ],
  },
  {
    i18nKey: "permissions.groups.moderation",
    flags: [
      {
        value: ArgonEntitlementFlags.DisconnectMember,
        i18nKey: "permissions.flags.DisconnectMember",
      },
      {
        value: ArgonEntitlementFlags.MoveMember,
        i18nKey: "permissions.flags.MoveMember",
      },
      {
        value: ArgonEntitlementFlags.MuteMember,
        i18nKey: "permissions.flags.MuteMember",
      },
      {
        value: ArgonEntitlementFlags.KickMember,
        i18nKey: "permissions.flags.KickMember",
      },
      {
        value: ArgonEntitlementFlags.BanMember,
        i18nKey: "permissions.flags.BanMember",
      },
    ],
  },
  {
    i18nKey: "permissions.groups.management",
    flags: [
      {
        value: ArgonEntitlementFlags.ManageChannels,
        i18nKey: "permissions.flags.ManageChannels",
      },
      {
        value: ArgonEntitlementFlags.ManageArchetype,
        i18nKey: "permissions.flags.ManageArchetype",
      },
      {
        value: ArgonEntitlementFlags.ManageBots,
        i18nKey: "permissions.flags.ManageBots",
      },
      {
        value: ArgonEntitlementFlags.ManageEvents,
        i18nKey: "permissions.flags.ManageEvents",
      },
      {
        value: ArgonEntitlementFlags.ManageBehaviour,
        i18nKey: "permissions.flags.ManageBehaviour",
      },
      {
        value: ArgonEntitlementFlags.ManageServer,
        i18nKey: "permissions.flags.ManageServer",
      },
    ],
  },
];

(window as any).extractEntitlements = extractEntitlements;
