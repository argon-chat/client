//     This code was generated by a Reinforced.Typings tool.
//     Changes to this file may cause incorrect behavior and will be lost if
//     the code is regenerated.

///<reference path="../Guid.d.ts"/>
///<reference path="../Either.d.ts"/>
///<reference path="../Maybe.ts"/>
///<reference path="IArgonEntity.d.ts"/>
///<reference path="LockdownReason.d.ts"/>

interface IUser extends IArgonEntity
{
	Email: string;
	Username: string;
	DisplayName: string;
	AvatarFileId?: string;
	ServerMembers: any[];
	LockdownReason: LockdownReason;
	LockDownExpiration?: Date;
}
