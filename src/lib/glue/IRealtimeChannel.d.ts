//     This code was generated by a Reinforced.Typings tool.
//     Changes to this file may cause incorrect behavior and will be lost if
//     the code is regenerated.

///<reference path="../Guid.d.ts"/>
///<reference path="../Either.d.ts"/>
///<reference path="../Maybe.ts"/>
///<reference path="IChannel.d.ts"/>
///<reference path="IRealtimeChannelUser.d.ts"/>

interface IRealtimeChannel
{
	Channel: IChannel;
	Users: IRealtimeChannelUser[];
}
