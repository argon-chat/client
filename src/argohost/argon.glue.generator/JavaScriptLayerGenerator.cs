﻿namespace argon.glue.generator;

using System.Collections;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Text;
using System.Text;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices.ComTypes;

public sealed record GeneratorOptions
{
    public string Value { get; }

    public GeneratorOptions(string value) => Value = value;
}

[Generator(LanguageNames.CSharp)]
public class JavaScriptLayerGenerator : IIncrementalGenerator
{
    public const string AttributeName = "Argon.Glue.JavaScriptLayerAttribute";

    private static readonly DiagnosticDescriptor MissingInterfaceError = new DiagnosticDescriptor(
        id: "JSLAYER001",
        title: "Interface Not Found",
        messageFormat: "Could not find the interface specified in JavaScriptLayerAttribute on class '{0}'",
        category: "JavaScriptLayerGenerator",
        DiagnosticSeverity.Error,
        isEnabledByDefault: true);

    protected static IncrementalValueProvider<GeneratorOptions> GetGeneratorOptions(
        IncrementalGeneratorInitializationContext context)
    {
        return context.AnalyzerConfigOptionsProvider
            .Select((options, _) =>
            {
                options.GlobalOptions
                    .TryGetValue("build_property.GenOutput", out var result);
                return new GeneratorOptions(result);
            });
    }

    public void Initialize(IncrementalGeneratorInitializationContext context)
    {
        var options = GetGeneratorOptions(context);
        var classesWithAttribute = context.SyntaxProvider
            .ForAttributeWithMetadataName(
                "Argon.Glue.Core.JavaScriptLayerAttribute`1",
                predicate: static (s, _) => s is ClassDeclarationSyntax,
                transform: static (ctx, _) => {
                    
                    var classSymbol = (INamedTypeSymbol)ctx.TargetSymbol;
                    var attribute = classSymbol.GetAttributes()
                        .FirstOrDefault(attr => attr.AttributeClass?.Name == "JavaScriptLayerAttribute");

                    if (attribute == null || attribute.AttributeClass.TypeArguments.Length != 1)
                        return default;

                    var interfaceType = attribute.AttributeClass.TypeArguments[0] as INamedTypeSymbol;
                    return (classSymbol, interfaceType);
                }).Combine(options);

        context.RegisterSourceOutput(classesWithAttribute, (spc, classData) => {

            var ((classSymbol, interfaceType), opt) = classData;

            if (interfaceType == null)
            {
                spc.ReportDiagnostic(Diagnostic.Create(MissingInterfaceError, classSymbol.Locations[0], classSymbol.Name));
                return;
            }

            GenerateLayers(spc, classSymbol, interfaceType, opt);
        });
    }
    private static void GenerateLayers(SourceProductionContext context, INamedTypeSymbol classSymbol,
        INamedTypeSymbol interfaceType, GeneratorOptions entryPoint)
    {

        var usings = new HashSet<string>
        {
            "System.Threading.Tasks",
            "System.Runtime.InteropServices.JavaScript",
            classSymbol.ContainingNamespace.ToDisplayString(),
            interfaceType.ContainingNamespace.ToDisplayString()
        };
        foreach (var member in interfaceType.GetMembers().OfType<IMethodSymbol>())
        {
            usings.Add(member.ReturnType.ContainingNamespace.ToDisplayString());
            foreach (var parameter in member.Parameters) usings.Add(parameter.Type.ContainingNamespace.ToDisplayString());
        }
        var sourceBuilder = new StringBuilder();
        sourceBuilder.AppendLine("// <auto-generated/>");
        sourceBuilder.AppendLine("// DO NOT TOUCH THIS FUCKING FILE, PROXY PROJECT REQUIRED FOR FUCKING ACCESS TO ORDERING OF PROJECTS (codegen not implemented this feature)");
        sourceBuilder.AppendLine("// </auto-generated>");
        sourceBuilder.AppendLine($"namespace Argon.Glue;");
        foreach (var ns in usings.Where(ns => !string.IsNullOrWhiteSpace(ns))) 
            sourceBuilder.AppendLine($"using {ns};");
        sourceBuilder.AppendLine($"using Argon.Glue.Core;");
        sourceBuilder.AppendLine($"public static partial class {classSymbol.Name}");
        sourceBuilder.AppendLine("{");

        foreach (var member in interfaceType.GetMembers().OfType<IMethodSymbol>())
        {
            var methodName = member.Name;
            var returnType = member.ReturnType as INamedTypeSymbol;
            var parameters = member.Parameters;

            string parameterList = parameters.Length > 0
                ? string.Join(", ", parameters.Select(p => $"[JSMarshalAs<JSType.Object>] JSObject {p.Name}"))
                : string.Empty;

            var genericReturnTypeStr = "JSObject";
            if (returnType is { IsGenericType: true })
            {
                var genericArgument = returnType.TypeArguments[0];
                genericReturnTypeStr = genericArgument.ToDisplayString();
            }

            string interopCall;
            if (parameters.Length > 0)
            {
                var firstParameter = parameters[0];
                interopCall = $@"
        Interop.DoCall<{genericReturnTypeStr}, {firstParameter.Type.Name}, {interfaceType.Name}>(
            (@interface, @in) => @interface.{methodName}(@in), {firstParameter.Name});";
            }
            else
            {
                interopCall = $@"
        Interop.DoCall<{genericReturnTypeStr}, {interfaceType.Name}>(
            (@interface) => @interface.{methodName}());";
            }

            sourceBuilder.AppendLine($@"
    [JSExport]
    [return: JSMarshalAs<JSType.Promise<JSType.Object>>]
    public static Task<JSObject> {methodName}({parameterList}) =>{interopCall}
");
        }

        sourceBuilder.AppendLine("}");

        // GO FUCK 
        //context.AddSource($"{classSymbol.Name}_generated.cs", SourceText.From(sourceBuilder.ToString(), Encoding.UTF8));

        // FUCKING FUCKING ROSHLYN WITH YOUR CROOKED SHIT WHAT THE FUCK RS1035 YOU FUCKING FUCKERS DIDN'T BOTHER TO DO THE EXECUTION ORDERING
        // File.WriteAllText(Path.Combine(entryPoint.Value, $"{classSymbol.Name}.generated.cs"), SourceText.From(sourceBuilder.ToString(), Encoding.UTF8).ToString());
        var fuckingFIle = typeof(System.IO.FileInfo).Assembly.GetType("System.IO.File");
        var writeAllTextMethod = fuckingFIle.GetMethod("WriteAllText", new[] { typeof(string), typeof(string) });
        writeAllTextMethod.Invoke(null, new object[] { Path.Combine(entryPoint.Value, $"{classSymbol.Name}.generated.cs"),
            SourceText.From(sourceBuilder.ToString(), Encoding.UTF8).ToString() });
    }
}