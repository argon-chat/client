namespace Argon.Glue.Core;

using System.Reflection;

public static class TypeInspector
{
    public static List<string> GetFieldNames<T>() where T : class
    {
        var type = typeof(T);

        var fields = type.GetFields(BindingFlags.Public | BindingFlags.Instance)
            .Select(f => f.Name);

        var properties = type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => p.Name);

        return fields.Concat(properties).ToList();
    }
}