namespace Argon.Glue;

using ActualLab.Fusion.Trimming;
using ActualLab.Interception.Trimming;
using ActualLab.Trimming;
using Contracts;
using Core;

public static partial class FusionCore
{
    internal static IServiceProvider RootProvider { get; private set; }

    [JSExport]
    public static Task BeginConnect(string endpoint)
    {
        CodeKeeper.Set<ProxyCodeKeeper, FusionProxyCodeKeeper>();
        if (RuntimeCodegen.NativeMode != RuntimeCodegenMode.DynamicMethods)
            CodeKeeper.RunActions();
        var services = new ServiceCollection()
            .AddFusion(fusion =>
            {
                fusion.Rpc.AddClient<IUserAuthorization>();
                fusion.Rpc.AddClient<IUserInteraction>();
            })
            .AddRpc(rpc =>
            {
                rpc.AddWebSocketClient(endpoint);
            });

        RootProvider = services.BuildServiceProvider();
        Interop.OnSetup(RootProvider);
        return Task.CompletedTask;
    }
}


[JavaScriptLayer<IUserAuthorization>()]
public static partial class UserAuthorization;
[JavaScriptLayer<IUserInteraction>()]
public static partial class UserInteraction;