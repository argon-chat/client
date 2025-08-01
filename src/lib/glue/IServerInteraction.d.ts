//     This code was generated by a Reinforced.Typings tool.
//     Changes to this file may cause incorrect behavior and will be lost if
//     the code is regenerated.

///<reference path="../Guid.d.ts"/>
///<reference path="../Either.d.ts"/>
///<reference path="../Maybe.ts"/>
///<reference path="ICreateChannelRequest.d.ts"/>
///<reference path="IRealtimeChannel.d.ts"/>
///<reference path="IArgonMessageDto.d.ts"/>
///<reference path="IMessageEntity.d.ts"/>
///<reference path="IRealtimeServerMember.d.ts"/>
///<reference path="JoinToChannelError.d.ts"/>
///<reference path="InviteCodeEntity.d.ts"/>
///<reference path="InviteCode.d.ts"/>
///<reference path="IUserDto.d.ts"/>
///<reference path="IUserProfileDto.d.ts"/>
///<reference path="IArchetypeDto.d.ts"/>
///<reference path="IArchetypeDtoGroup.d.ts"/>
///<reference path="IChannelEntitlementOverwrite.d.ts"/>

interface IServerInteraction
{
	CreateChannel(request: ICreateChannelRequest) : Promise<void>;
	DeleteChannel(serverId: Guid, channelId: Guid) : Promise<void>;
	GetChannels(serverId: Guid) : Promise<IRealtimeChannel[]>;
	GetMessages(channelId: Guid, count: number, offset: number) : Promise<IArgonMessageDto[]>;
	QueryMessages(channelId: Guid, from: number, limit: number) : Promise<IArgonMessageDto[]>;
	SendMessage(channelId: Guid, text: string, entities: IMessageEntity[], replyTo: number) : Promise<void>;
	GetMembers(serverId: Guid) : Promise<IRealtimeServerMember[]>;
	GetMember(serverId: Guid, userId: Guid) : Promise<IRealtimeServerMember>;
	JoinToVoiceChannel(serverId: Guid, channelId: Guid) : Promise<Either<string, JoinToChannelError>>;
	DisconnectFromVoiceChannel(serverId: Guid, channelId: Guid) : Promise<void>;
	GetInviteCodes(serverId: Guid) : Promise<InviteCodeEntity[]>;
	CreateInviteCode(serverId: Guid, expiration: any) : Promise<InviteCode>;
	PrefetchUser(serverId: Guid, userId: Guid) : Promise<IUserDto>;
	PrefetchProfile(serverId: Guid, userId: Guid) : Promise<IUserProfileDto>;
	GetServerArchetypes(serverId: Guid) : Promise<IArchetypeDto[]>;
	CreateArchetypeAsync(serverId: Guid, name: string) : Promise<IArchetypeDto>;
	UpdateArchetypeAsync(serverId: Guid, dto: IArchetypeDto) : Promise<IArchetypeDto>;
	SetArchetypeToMember(serverId: Guid, memberId: Guid, archetypeId: Guid, isGrant: boolean) : Promise<boolean>;
	GetDetailedServerArchetypes(serverId: Guid) : Promise<IArchetypeDtoGroup[]>;
	UpsertArchetypeEntitlementForChannel(serverId: Guid, channelId: Guid, archetypeId: Guid, deny: number, allow: number) : Promise<IChannelEntitlementOverwrite>;
	KickMemberFromChannel(serverId: Guid, channelId: Guid, memberId: Guid) : Promise<boolean>;
}
