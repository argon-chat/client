using DeHive;
using DeHive.Abstractions;
using Genbox.SimpleS3.Core.Abstracts.Clients;
using Genbox.SimpleS3.Core.Abstracts.Enums;
using Genbox.SimpleS3.Core.Common.Authentication;
using Genbox.SimpleS3.Core.Extensions;
using Genbox.SimpleS3.Extensions.GenericS3.Extensions;
using Genbox.SimpleS3.Extensions.HttpClient.Extensions;
using Microsoft.Build.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Newtonsoft.Json;
using Nuke.Common;
using Nuke.Common.CI;
using Nuke.Common.Execution;
using Nuke.Common.IO;
using Nuke.Common.ProjectModel;
using Nuke.Common.Tooling;
using Nuke.Common.Tools.GitVersion;
using Nuke.Common.Utilities.Collections;
using Serilog;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using static Nuke.Common.EnvironmentInfo;
using static Nuke.Common.IO.PathConstruction;
using JsonSerializer = System.Text.Json.JsonSerializer;

class Build : NukeBuild
{
    [Parameter] readonly string Channel = "beta";

    [GitVersion] readonly GitVersion GitVersion;

    public static int Main() => Execute<Build>(x => x.UploadWebViewToS3);

    AbsolutePath FrontendDir => RootDirectory;
    AbsolutePath FrontendDist => RootDirectory / "dist";
    AbsolutePath OutputDir => RootDirectory / "publish";
    AbsolutePath HiveBundle => OutputDir / "argon.ui.hb";
    AbsolutePath TempDir => RootDirectory / ".temp";
    AbsolutePath HiveBundleManifest =>
        TempDir / $"ui.{Channel}.json";
    FileInfo DeHiveManifest => (RootDirectory / "dehive.manifest.json").ToFileInfo();

    readonly Tool Bun = ToolResolver.GetPathTool("bun");

    string HiveBundleSha256
    {
        get => Environment.GetEnvironmentVariable("HIVE_BUNDLE_SHA256");
        set => Environment.SetEnvironmentVariable("HIVE_BUNDLE_SHA256", value);
    }

    Target FrontendRestore => _ => _
        .Executes(() =>
        {
            Bun("install", workingDirectory: FrontendDir);
        });

    Target FrontendBuild => _ => _
        .DependsOn(FrontendRestore)
        .Executes(() =>
        {
            FrontendDist.CreateOrCleanDirectory();

            Bun("run build", workingDirectory: FrontendDir);
        });

    Target PackResult => _ => _
        .DependsOn(FrontendBuild)
        .Executes(async () => {
            var manifest = JsonConvert.DeserializeObject<DeHiveManifest>(await File.ReadAllTextAsync(DeHiveManifest.FullName));
            var packSettings = new DeHive.HiveDatabankSettings(new DirectoryInfo(manifest.Root),
                new DirectoryInfo(manifest.OutputPath), 1024 * 1024 * 1024, 1024, manifest.BankName)
            {
                EnableSharding = false,
                UseCompression = manifest.UseCompression,
            };


            await HiveDataBank.CreateAsync(packSettings, builder => {
                builder.AddFolder(new DirectoryInfo(manifest.Root));
            }, new CommandProgress());

            using var sha = SHA256.Create();
            await using var zip = File.OpenRead(HiveBundle);
            HiveBundleSha256 = Convert.ToHexString(
                sha.ComputeHash(zip)
            ).ToLowerInvariant();
            Log.Information("Bundle UI generated: {Path}", HiveBundle);
            Log.Information("Bundle UI SHA256: {Hash}", HiveBundleSha256);
        });

    static ExecOs EmptyExecOs() => new(
        new ExecTarget(string.Empty, [])
    );

    Target GenerateHiveBundleManifest => _ => _
        .DependsOn(PackResult)
        .Executes(() => {
            HiveBundleSha256.NotNullOrEmpty(nameof(HiveBundleSha256));
            TempDir.CreateOrCleanDirectory();

            var manifest = new UpdateManifest(
                Component: ArgonComponentKind.webview,
                Version: GitVersion.AssemblySemFileVer,
                Packages:
                [
                    new UpdatePackage(
                        PackageName: "argon.ui.hb",
                        Url: $"runtime/ui/{GitVersion.AssemblySemFileVer}/argon.ui.hb",
                        Hash: HiveBundleSha256,
                        Tool: "cp",
                        RelativePath: "@/modules/argon.ui.hb"
                    )
                ],
                PostInstallHooks: [],
                ExecOs: EmptyExecOs()
            );

            var json = JsonSerializer.Serialize(
                manifest,
                new JsonSerializerOptions
                {
                    WriteIndented = true,
                    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
                });

            File.WriteAllText(HiveBundleManifest, json);

            Log.Information("WebView manifest generated: {Path}", HiveBundleManifest);
        });

    Target UploadWebViewToS3 => _ => _
      .DependsOn(GenerateHiveBundleManifest)
      .Executes(async () => {
          var s3 = CreateS3();

          var runtimeKey = $"runtime/ui/{GitVersion.AssemblySemFileVer}/argon.ui.hb";
          var manifestKey = $"manifests/ui.{Channel}.json";

          Log.Information("Uploading UI bundle to S3. Key={Key}, Path={Path}", runtimeKey, HiveBundle);

          var bundleInfo = new FileInfo(HiveBundle);
          Log.Information(
              "UI bundle file info: Exists={Exists}, Size={Size} bytes",
              bundleInfo.Exists,
              bundleInfo.Exists ? bundleInfo.Length : 0
          );

          await using (var fs = File.OpenRead(HiveBundle))
          {
              var putResp = await s3.PutObjectAsync(
                  bucketName: S3Bucket,
                  objectKey: runtimeKey,
                  fs
              );

              Log.Information(
                  "UI bundle uploaded. HttpStatus={Status}, ETag={ETag}, RequestId={RequestId}",
                  putResp.StatusCode,
                  putResp.ETag,
                  putResp.RequestId
              );

              if (putResp.StatusCode != 200)
                  throw new InvalidOperationException("");
          }

          var headBundle = await s3.GetObjectAsync(S3Bucket, runtimeKey);
          Log.Information(
              "UI bundle verified via HEAD. ContentLength={Length}, ETag={ETag}",
              headBundle.ContentLength,
              headBundle.ETag
          );

          Log.Information("Uploading UI manifest to S3. Key={Key}, Path={Path}", manifestKey, HiveBundleManifest);

          var manifestInfo = new FileInfo(HiveBundleManifest);
          Log.Information(
              "Manifest file info: Exists={Exists}, Size={Size} bytes",
              manifestInfo.Exists,
              manifestInfo.Exists ? manifestInfo.Length : 0
          );
          try
          {
              await s3.GetObjectAsync("__definitely_not_existing__", "x");
          }
          catch (Exception ex)
          {
              Log.Warning("S3 probe exception type={Type}, Message={Msg}", ex.GetType().Name, ex.Message);
          }

          await using (var fs = File.OpenRead(HiveBundleManifest))
          {
              var putResp = await s3.PutObjectAsync(
                  bucketName: S3Bucket,
                  objectKey: manifestKey,
                  fs,
                  request => request.ContentType.Set("application/json")
              );

              Log.Information(
                  "Manifest uploaded. HttpStatus={Status}, ETag={ETag}, RequestId={RequestId}",
                  putResp.StatusCode,
                  putResp.ETag,
                  putResp.RequestId
              );
              if (putResp.StatusCode != 200)
                  throw new InvalidOperationException("");
          }

          var headManifest = await s3.GetObjectAsync(S3Bucket, manifestKey);
          Log.Information(
              "Manifest verified via HEAD. ContentLength={Length}, ETag={ETag}",
              headManifest.ContentLength,
              headManifest.ETag
          );

          Log.Information("UI bundle artifacts upload finished successfully");
      });


    [Parameter][Secret] readonly string S3Endpoint;
    [Parameter][Secret] readonly string S3Region;
    [Parameter][Secret] readonly string S3Bucket;

    [Parameter][Secret] readonly string S3AccessKey;
    [Parameter][Secret] readonly string S3SecretKey;


    IObjectClient CreateS3()
    {
        var services = new ServiceCollection();
        var coreBuilder = SimpleS3CoreServices.AddSimpleS3Core(services);

        coreBuilder.UseGenericS3(config => {
            config.Endpoint = this.S3Endpoint;
            config.RegionCode = this.S3Region;
            config.Credentials = new StringAccessKey(this.S3AccessKey, this.S3SecretKey);
            config.NamingMode = NamingMode.PathStyle;
        });
        coreBuilder.UseHttpClient();
        IServiceProvider serviceProvider = services.BuildServiceProvider();
        return serviceProvider.GetRequiredService<IObjectClient>();
    }
}

public class CommandProgress : IHiveProgress
{
    public ulong Total { get; set; }
    public long Progress { get; set; }
    public void IncAndReport()
    {
        Progress++;
        if (Total == 0)
            return;

        var percent = Progress * 100 / (long)Total;

        Log.Logger.Information("Bundle UI Progress: {Progress}/{Total} ({Percent}%)", Progress, Total, percent);
    }
}

public record DeHiveManifest
{
    [JsonProperty("name")]
    public required string BankName { get; set; }
    [JsonProperty("root")]
    public required string Root { get; set; }
    [JsonProperty("output")]
    public required string OutputPath { get; set; }
    [JsonProperty("compression")]
    public bool UseCompression { get; set; }
}

public enum ArgonComponentKind
{
    core,
    ui,
    webview,
    tools,
    bootloader
}
public record UpdatePackage(
    [property: JsonPropertyName("name")]
    string PackageName,

    [property: JsonPropertyName("url")]
    string? Url,

    [property: JsonPropertyName("hash")]
    string Hash,

    [property: JsonPropertyName("tool")]
    string Tool,

    // unpack or emit relative path
    [property: JsonPropertyName("relativePath")]
    string RelativePath
);
public record PostInstallHook(
    [property: JsonPropertyName("hook")] string HookName,
    [property: JsonPropertyName("tool")] string Tool,
    [property: JsonPropertyName("query")] string? Query,
    [property: JsonPropertyName("origin")] string? Origin,
    [property: JsonPropertyName("target")] string? Target,
    [property: JsonPropertyName("override")]
    bool Override
);
public record UpdateManifest(
    [property: JsonPropertyName("component")] ArgonComponentKind Component,
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("pkgs")] List<UpdatePackage> Packages,
    [property: JsonPropertyName("postInstallHooks")] List<PostInstallHook> PostInstallHooks,
    [property: JsonPropertyName("execTarget")] ExecOs ExecOs
);
public record ExecOs(
    [property: JsonPropertyName("windows")]
    ExecTarget Windows
);

public record ExecTarget(
    [property: JsonPropertyName("bin")] string Bin,
    [property: JsonPropertyName("args")] List<string> Args
);

public record UpdaterManifestInfo(
    [property: JsonPropertyName("latestHash")]
    string LatestHash,
    [property: JsonPropertyName("url")] string Url
);
