//     This code was generated by a Reinforced.Typings tool.
//     Changes to this file may cause incorrect behavior and will be lost if
//     the code is regenerated.

///<reference path="../Guid.d.ts"/>
///<reference path="../Either.d.ts"/>
///<reference path="../Maybe.ts"/>
///<reference path="UserStatus.d.ts"/>

interface UserChangedStatus extends IArgonEvent
{
	EventKey: 'UserChangedStatus';
	userId: Guid;
	status: UserStatus;
	bag: string[];
	Sequence: number;
	EventId: number;
}
