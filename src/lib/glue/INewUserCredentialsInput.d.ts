//     This code was generated by a Reinforced.Typings tool.
//     Changes to this file may cause incorrect behavior and will be lost if
//     the code is regenerated.

///<reference path="../Guid.d.ts"/>
///<reference path="../Either.d.ts"/>
///<reference path="../Maybe.ts"/>

interface INewUserCredentialsInput
{
	Email: string;
	Username: string;
	PhoneNumber?: string;
	Password: string;
	DisplayName: string;
	BirthDate: Date;
	AgreeTos: boolean;
	AgreeOptionalEmails: boolean;
	captchaToken?: string;
}
