namespace Argon.Glue.Core;

using System.Reflection;
using ActualLab.Fusion;
using System.Runtime.InteropServices.JavaScript;
using Microsoft.Extensions.DependencyInjection;

public static partial class Interop
{
    private static IServiceProvider? RootProvider { get; set; }


    public static void OnSetup(IServiceProvider serviceProvider) => RootProvider ??= serviceProvider;


    [JSImport("globalThis.cro")]
    public static partial JSObject CreateObject();
    // wait until JSObject dynamic feature
    public static async Task<JSObject> DoCall<TOut, TIn, TInterface>(Func<TInterface, TIn, Task<TOut>> func, JSObject tIn)
        where TInterface : notnull
        where TIn : class
        where TOut : class
    {
        if (RootProvider is null)
            throw new InvalidOperationException($"Not configured");

        var fieldsTIn = TypeInspector.GetFieldNames<TIn>();

        var dictIn = new Dictionary<string, string>();

        foreach (var v in fieldsTIn)
            dictIn.Add(v, tIn.GetPropertyAsString(v)!);
        var tInValue = CastFromDictionary<TIn>(dictIn);

        var result = await func(RootProvider.GetRequiredService<TInterface>(), tInValue);

        var dictOut = ConvertToDictionary(result);
        var obj = CreateObject();

        foreach (var (key, value) in dictOut) 
            obj.SetProperty(key, value);

        return obj;
    }

    // wait until JSObject dynamic feature
    public static async Task<JSObject> DoCall<TOut, TInterface>(Func<TInterface, Task<TOut>> func)
        where TInterface : notnull
        where TOut : class
    {
        if (RootProvider is null)
            throw new InvalidOperationException($"Not configured");

        var result = await func(RootProvider.GetRequiredService<TInterface>());

        var dictOut = ConvertToDictionary(result);
        var obj = CreateObject();

        foreach (var (key, value) in dictOut)
            obj.SetProperty(key, value);

        return obj;
    }

    private static T CastFromDictionary<T>(Dictionary<string, string> dictionary) where T : class
    {
        var type = typeof(T);

        var ctor = type.GetConstructors()
            .FirstOrDefault(c => c.GetParameters().All(p => dictionary.ContainsKey(p.Name)));

        foreach (var constructorInfo in type.GetConstructors())
        {
            Console.WriteLine($"{constructorInfo.Name} for {string.Join(',', constructorInfo.GetParameters().Select(x => $"{x.Name}:{x.ParameterType.FullName}"))}");
        }

        if (ctor == null)
            throw new InvalidOperationException($"ctor not found for '{type.FullName}'");

        var args = ctor.GetParameters()
            .Select(p => Convert.ChangeType(dictionary[p.Name!], p.ParameterType))
            .ToArray();

        return (T)ctor.Invoke(args);
    }

    private static Dictionary<string, string> ConvertToDictionary<T>(T dto) where T : class
    {
        var dictionary = new Dictionary<string, string>();
        var type = typeof(T);

        var properties = type.GetProperties(BindingFlags.Public | BindingFlags.Instance);

        foreach (var property in properties)
        {
            var value = property.GetValue(dto);

            if (value != null) dictionary[property.Name] = value.ToString();
        }

        return dictionary;
    }
}