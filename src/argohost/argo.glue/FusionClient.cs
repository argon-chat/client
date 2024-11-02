namespace argo.glue;

using ActualLab.Fusion;
using ActualLab.Fusion.Trimming;
using ActualLab.Interception.Trimming;
using ActualLab.Reflection;
using ActualLab.Rpc;
using ActualLab.Rpc.Clients;
using ActualLab.Trimming;
using Argon.Contracts;
using Microsoft.Extensions.DependencyInjection;

public static class FusionClient
{
    public static ValueTask Create(string endpoint)
    {
        CodeKeeper.Set<ProxyCodeKeeper, FusionProxyCodeKeeper>();
        if (RuntimeCodegen.NativeMode != RuntimeCodegenMode.DynamicMethods)
            CodeKeeper.RunActions();
        var services = new ServiceCollection()
            .AddFusion(fusion =>
            {
                fusion.Rpc.AddClient<IUserAuthorization>();
            })
            .AddRpc(rpc =>
            {
                rpc.AddWebSocketClient();
            });
        return ValueTask.CompletedTask;
        
    }
}