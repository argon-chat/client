import { dotnet, GlueRuntime } from ':glue/dotnet'


export async function init(): Promise<GlueRuntime> {
    return await dotnet
        .withDiagnosticTracing(false)
        .withApplicationArgumentsFromQuery()
        .create();
}

export type { GlueRuntime }