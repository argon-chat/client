import { dotnet, type GlueRuntime } from ":glue/dotnet";

export async function init(): Promise<GlueRuntime> {
  (window as any).cro = () => ({});
  return await dotnet
    .withDiagnosticTracing(false)
    .withApplicationArgumentsFromQuery()
    .create();
}

export type { GlueRuntime };
