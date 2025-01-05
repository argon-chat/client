//     This code was generated by a Reinforced.Typings tool.
//     Changes to this file may cause incorrect behavior and will be lost if
//     the code is regenerated.

///<reference path="../Guid.d.ts"/>
///<reference path="../Either.d.ts"/>
///<reference path="../Maybe.ts"/>
///<reference path="Argon/ArchetypeModel/IArchetypeSubject.d.ts"/>
///<reference path="IArgonEntityWithOwnership.d.ts"/>
///<reference path="IChannel.d.ts"/>
///<reference path="IServerMember.d.ts"/>
///<reference path="IArchetype.d.ts"/>

interface IServer extends Argon.ArchetypeModel.IArchetypeSubject, IArgonEntityWithOwnership
{
	Name: string;
	Description?: string;
	AvatarFileId?: string;
	Channels: IChannel[];
	Users: IServerMember[];
	Archetypes: IArchetype[];
	SubjectArchetypes: any[];
}
