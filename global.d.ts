import { ObjectDirective } from "vue";
export {};
type ArgonEntitlementUnion = 
  | 'None'
  | 'ViewChannel'
  | 'ReadHistory'
  | 'JoinToVoice'
  | 'Base'
  | 'SendMessages'
  | 'SendVoice'
  | 'AttachFiles'
  | 'AddReactions'
  | 'AnyMentions'
  | 'MentionEveryone'
  | 'ExternalEmoji'
  | 'ExternalStickers'
  | 'UseCommands'
  | 'PostEmbeddedLinks'
  | 'BaseChat'
  | 'Connect'
  | 'Speak'
  | 'Video'
  | 'Stream'
  | 'BaseMedia'
  | 'BaseMember'
  | 'UseASIO'
  | 'AdditionalStreams'
  | 'BaseExtended'
  | 'DisconnectMember'
  | 'MoveMember'
  | 'BanMember'
  | 'MuteMember'
  | 'KickMember'
  | 'ModerateMembers'
  | 'ManageChannels'
  | 'ManageArchetype'
  | 'ManageBots'
  | 'ManageEvents'
  | 'ManageBehaviour'
  | 'ManageServer'
  | 'ControlServer'
  | 'Administrator';

declare module '@vue/runtime-core' {
    interface GlobalDirectives {
        vPex: Directive<HTMLElement, ArgonEntitlementUnion>;
    }
}