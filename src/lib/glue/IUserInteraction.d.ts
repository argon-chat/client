//     This code was generated by a Reinforced.Typings tool.
//     Changes to this file may cause incorrect behavior and will be lost if
//     the code is regenerated.

///<reference path="../Guid.d.ts"/>
///<reference path="../Either.d.ts"/>
///<reference path="../Maybe.ts"/>
///<reference path="IUser.d.ts"/>
///<reference path="IServer.d.ts"/>
///<reference path="AuthorizationError.d.ts"/>
///<reference path="IUserCredentialsInput.d.ts"/>
///<reference path="RegistrationError.d.ts"/>
///<reference path="INewUserCredentialsInput.d.ts"/>
///<reference path="AcceptInviteError.d.ts"/>
///<reference path="InviteCode.d.ts"/>

interface IUserInteraction
{
	GetMe() : Promise<IUser>;
	CreateServer(request: any) : Promise<IServer>;
	GetServers() : Promise<IServer[]>;
	Authorize(input: IUserCredentialsInput) : Promise<Either<string, AuthorizationError>>;
	Registration(input: INewUserCredentialsInput) : Promise<Either<string, RegistrationError>>;
	JoinToServerAsync(inviteCode: InviteCode) : Promise<Either<IServer, AcceptInviteError>>;
}
