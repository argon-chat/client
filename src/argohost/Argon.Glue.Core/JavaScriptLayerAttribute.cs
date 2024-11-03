namespace Argon.Glue.Core;

using ActualLab.Rpc;

[AttributeUsage(AttributeTargets.Class)]
public class JavaScriptLayerAttribute<T>() : Attribute where T : IRpcService
{
    public Type TargetInterface { get; } = typeof(T);
}