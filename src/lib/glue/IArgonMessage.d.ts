//     This code was generated by a Reinforced.Typings tool.
//     Changes to this file may cause incorrect behavior and will be lost if
//     the code is regenerated.

///<reference path="../Guid.d.ts"/>
///<reference path="../Either.d.ts"/>
///<reference path="../Maybe.ts"/>
///<reference path="Argon/IArgonEntityWithOwnershipNoKey.d.ts"/>
///<reference path="IMessageEntity.d.ts"/>

interface IArgonMessage extends Argon.IArgonEntityWithOwnershipNoKey
{
	MessageId: number;
	ServerId: Guid;
	ChannelId: Guid;
	Reply?: number;
	Entities: IMessageEntity[];
}
