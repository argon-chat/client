//     This code was generated by a Reinforced.Typings tool.
//     Changes to this file may cause incorrect behavior and will be lost if
//     the code is regenerated.

///<reference path="../Guid.d.ts"/>
///<reference path="../Either.d.ts"/>
///<reference path="../Maybe.ts"/>
///<reference path="RegistrationError.d.ts"/>

interface IRegistrationErrorData
{
	Code: RegistrationError;
	Field: string;
	Message: string;
	EmailAlreadyRegistered() : IRegistrationErrorData;
	UsernameAlreadyTaken() : IRegistrationErrorData;
	UsernameReserved() : IRegistrationErrorData;
	InternalError() : IRegistrationErrorData;
}
