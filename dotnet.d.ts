declare module ':glue/dotnet' {
  export namespace dotnet {
    function withDiagnosticTracing(enable: boolean): GlueRuntimeInstance;
    function withApplicationArgumentsFromQuery(): GlueRuntimeInstance;
    function withConfig(config: MonoConfig): GlueRuntimeInstance;
    function withConfigSrc(configSrc: string): GlueRuntimeInstance;
    function withApplicationArguments(...args: string[]): GlueRuntimeInstance;
    function withEnvironmentVariable(name: string, value: string): GlueRuntimeInstance;
    function withEnvironmentVariables(variables: {
        [i: string]: string;
    }): GlueRuntimeInstance;
    function withVirtualWorkingDirectory(vfsPath: string): GlueRuntimeInstance;
    function withResourceLoader(loadBootResource?: LoadBootResourceCallback): GlueRuntimeInstance;
    function create(): Promise<GlueRuntime>;
    function invokeMethodAsync(assemblyName: string, methodName: string, ...args: any[]): Promise<any>;
    function invokeMethod(assemblyName: string, methodName: string, ...args: any[]): any;
    function findJSObjectReference(id: number): JSObjectReference;
    function createJSObjectReference(obj: any): JSObjectReference;
    function disposeJSObjectReference(obj: JSObjectReference): void;

      export function withDiagnosticTracing(arg0: boolean) {
          throw new Error('Function not implemented.');
      }
  }

  interface JSObjectReference {
    invokeMethodAsync(methodName: string, ...args: any[]): Promise<any>;
    invokeMethod(methodName: string, ...args: any[]): any;
    dispose(): void;
  }
  interface GlueRuntimeInstance {
    withDiagnosticTracing(enable: boolean): GlueRuntimeInstance;
    withApplicationArgumentsFromQuery(): GlueRuntimeInstance;
    withConfig(config: MonoConfig): GlueRuntimeInstance;
    withConfigSrc(configSrc: string): GlueRuntimeInstance;
    withApplicationArguments(...args: string[]): GlueRuntimeInstance;
    withEnvironmentVariable(name: string, value: string): GlueRuntimeInstance;
    withEnvironmentVariables(variables: {
        [i: string]: string;
    }): GlueRuntimeInstance;
    withVirtualWorkingDirectory(vfsPath: string): GlueRuntimeInstance;
    withResourceLoader(loadBootResource?: LoadBootResourceCallback): GlueRuntimeInstance;
    create(): Promise<GlueRuntime>;
  }
  interface GlueRuntime {
    dispose(): void;
    getAssemblyExports(assemblyName: string): Promise<any>;

    INTERNAL: any;
    Module: any;
    runtimeId: number;
    runtimeBuildInfo: {
        productVersion: string;
        gitHash: string;
        buildConfiguration: string;
        wasmEnableThreads: boolean;
        wasmEnableSIMD: boolean;
        wasmEnableExceptionHandling: boolean;
    };
  }
}