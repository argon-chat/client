namespace argon.glue.gen;

using Reinforced.Typings.Fluent;
using System.Collections.Generic;
using ActualLab;
using Argon.Contracts;
using Reinforced.Typings.Ast.TypeNames;

public class TypingsConfiguration
{
    public static void Configure(ConfigurationBuilder builder)
    {
        builder.Substitute(typeof(Guid), new RtSimpleTypeName("string"));
        builder.Substitute(typeof(DateTime), new RtSimpleTypeName("Date"));
        builder.Substitute(typeof(DateTimeOffset), new RtSimpleTypeName("Date"));
        builder.ExportAsInterface<AuthorizeRequest>().WithAllProperties().DontIncludeToNamespace();
        builder.ExportAsInterface<AuthorizeResponse>().WithAllProperties().DontIncludeToNamespace();
        builder.ExportAsInterface<ServerDetailsRequest>().WithAllProperties().DontIncludeToNamespace();
        builder.ExportAsInterface<UserResponse>().WithAllProperties().DontIncludeToNamespace();
        builder.ExportAsInterface<CreateServerRequest>().WithAllProperties().DontIncludeToNamespace();
        builder.ExportAsInterface<ServerResponse>().WithAllProperties().DontIncludeToNamespace();
        builder.ExportAsInterface<ServerDetailsResponse>().WithAllProperties().DontIncludeToNamespace();
        builder.ExportAsInterface<ChannelJoinRequest>().WithAllProperties().DontIncludeToNamespace();
        builder.ExportAsInterface<ChannelJoinResponse>().WithAllProperties().DontIncludeToNamespace();
        builder.ExportAsInterface<IUserAuthorization>().WithPublicMethods().DontIncludeToNamespace();
        builder.ExportAsInterface<IUserInteraction>().WithPublicMethods().DontIncludeToNamespace();

        builder.Global(x =>
        {
            x.ExportPureTypings();
            x.UseModules(false);
            x.AutoAsync();
            x.GenerateDocumentation();
            x.AutoOptionalProperties();
        });
    }
}