using DeHive;
using DeHive.Abstractions;
using DeltaQ.BsDiff;
using DeltaQ.SuffixSorting;
using DeltaQ.SuffixSorting.LibDivSufSort;
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

    public static int Main() => Execute<Build>(x => x.GenerateAndUploadUiDelta);

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
            Bun("install --frozen-lockfile", workingDirectory: FrontendDir);
        });

    Target UpdatePackageJson => _ => _
        .DependsOn(FrontendRestore)
        .Executes(() =>
        {
            var packageJsonPath = FrontendDir / "package.json";
            Log.Information("Updating package.json with build metadata: {Path}", packageJsonPath);

            var packageJson = File.ReadAllText(packageJsonPath);
            
            var lastBuildTime = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ");
            var fullVersion = $"{GitVersion.FullSemVer}+{GitVersion.Sha.Substring(0, 8)}";
            var branch = GitVersion.BranchName;
            var version = GitVersion.AssemblySemFileVer;

            packageJson = packageJson
                .Replace("\"{lastBuildTime}\"", $"\"{lastBuildTime}\"")
                .Replace("\"{fullVersion}\"", $"\"{fullVersion}\"")
                .Replace("\"{branch}\"", $"\"{branch}\"")
                .Replace("\"0.0.0\"", $"\"{version}\"");

            File.WriteAllText(packageJsonPath, packageJson);

            Log.Information("Updated package.json: Version={Version}, FullVersion={FullVersion}, Branch={Branch}, BuildTime={BuildTime}",
                version, fullVersion, branch, lastBuildTime);
        });

    Target FrontendBuild => _ => _
        .DependsOn(UpdatePackageJson)
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


    #region UI Delta Generation

    const int MaxDeltaChainLength = 3;
    AbsolutePath DeltaTemp => RootDirectory / ".delta_temp";

    Target GenerateAndUploadUiDelta => _ => _
        .DependsOn(UploadWebViewToS3)
        .Executes(async () =>
        {
            var s3 = CreateS3();
            var version = GitVersion.AssemblySemFileVer;
            var deltaManifestKey = $"manifests/ui.{Channel}.deltas.json";

            // 1. Fetch existing delta manifest
            DeltaManifest? existingDeltaManifest = null;
            try
            {
                var resp = await s3.GetObjectAsync(S3Bucket, deltaManifestKey);
                if (resp.IsSuccess)
                {
                    existingDeltaManifest = await JsonSerializer.DeserializeAsync<DeltaManifest>(resp.Content);
                    Log.Information("Existing UI delta manifest: targetVersion={Version}, chain={Count}",
                        existingDeltaManifest?.TargetVersion, existingDeltaManifest?.Chain.Count);
                }
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "No existing UI delta manifest found");
            }

            // 2. Determine previous version
            var previousVersion = existingDeltaManifest?.TargetVersion;
            if (previousVersion is null || previousVersion.Equals(version, StringComparison.OrdinalIgnoreCase))
            {
                Log.Information("No previous UI version to diff against. Uploading empty delta manifest.");
                await UploadUiDeltaManifest(s3, new DeltaManifest(
                    ArgonComponentKind.webview, version, new FileInfo(HiveBundle).Length, []));
                return;
            }

            Log.Information("Generating UI delta: {From} → {To}", previousVersion, version);

            // 3. Download previous .hb from S3
            DeltaTemp.CreateOrCleanDirectory();
            var prevKey = $"runtime/ui/{previousVersion}/argon.ui.hb";
            var prevHbPath = DeltaTemp / $"prev-{previousVersion}.hb";

            try
            {
                var prevResp = await s3.GetObjectAsync(S3Bucket, prevKey);
                if (!prevResp.IsSuccess)
                {
                    Log.Warning("Previous argon.ui.hb not found: {Key}. Skipping delta.", prevKey);
                    await UploadUiDeltaManifest(s3, new DeltaManifest(
                        ArgonComponentKind.webview, version, new FileInfo(HiveBundle).Length, []));
                    return;
                }

                await using (var fs = File.Create(prevHbPath))
                {
                    await prevResp.Content.CopyToAsync(fs);
                }
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Failed to download previous UI bundle. Skipping delta.");
                await UploadUiDeltaManifest(s3, new DeltaManifest(
                    ArgonComponentKind.webview, version, new FileInfo(HiveBundle).Length,
                    existingDeltaManifest?.Chain ?? []));
                return;
            }

            // 4. Generate bsdiff
            var deltaPath = DeltaTemp / $"{previousVersion}-to-{version}.bsdiff";

            var oldData = await File.ReadAllBytesAsync(prevHbPath);
            var newData = await File.ReadAllBytesAsync(HiveBundle);
            ISuffixSort suffixSorter = new LibDivSufSort();

            await using (var deltaStream = File.Create(deltaPath))
            {
                Diff.Create(oldData, newData, deltaStream, suffixSorter);
            }

            // 5. Compute hash and upload
            var deltaHash = await ComputeFileHashAsync(deltaPath);
            var deltaSize = new FileInfo(deltaPath).Length;
            var deltaS3Key = $"runtime/ui/deltas/{previousVersion}-to-{version}.bsdiff";

            Log.Information("Uploading UI delta to S3: {Key} ({Size:N1} MB)",
                deltaS3Key, deltaSize / 1024.0 / 1024.0);

            await using (var fs = File.OpenRead(deltaPath))
            {
                await s3.PutObjectAsync(S3Bucket, deltaS3Key, fs);
            }

            // 6. Update chain
            var newEntry = new DeltaEntry(
                previousVersion, version, deltaS3Key, deltaHash, deltaSize);

            var chain = existingDeltaManifest?.Chain.ToList() ?? [];
            chain.Add(newEntry);

            var removedEntries = new List<DeltaEntry>();
            while (chain.Count > MaxDeltaChainLength)
            {
                removedEntries.Add(chain[0]);
                chain.RemoveAt(0);
            }

            await UploadUiDeltaManifest(s3, new DeltaManifest(
                ArgonComponentKind.webview, version, new FileInfo(HiveBundle).Length, chain));

            // 7. Cleanup old deltas
            foreach (var removed in removedEntries)
            {
                try
                {
                    Log.Information("Deleting old UI delta: {Key}", removed.Url);
                    await s3.DeleteObjectAsync(S3Bucket, removed.Url);
                }
                catch (Exception ex)
                {
                    Log.Warning(ex, "Failed to delete old UI delta {Key}", removed.Url);
                }
            }

            Log.Information("UI delta generation complete. Chain length={Count}", chain.Count);
        });

    async Task UploadUiDeltaManifest(IObjectClient s3, DeltaManifest manifest)
    {
        var key = $"manifests/ui.{Channel}.deltas.json";
        var json = JsonSerializer.Serialize(manifest, new JsonSerializerOptions
        {
            WriteIndented = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        });

        await using var ms = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(json));
        await s3.PutObjectAsync(S3Bucket, key, ms,
            request => request.ContentType.Set("application/json"));

        Log.Information("UI delta manifest uploaded: {Key}", key);
    }

    static async Task<string> ComputeFileHashAsync(AbsolutePath filePath)
    {
        using var sha = SHA256.Create();
        await using var fs = File.OpenRead(filePath);
        var hash = await sha.ComputeHashAsync(fs);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    #endregion


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

public record DeltaManifest(
    [property: JsonPropertyName("component")]
    ArgonComponentKind Component,

    [property: JsonPropertyName("targetVersion")]
    string TargetVersion,

    [property: JsonPropertyName("fullPackageSize")]
    long FullPackageSize,

    [property: JsonPropertyName("chain")]
    List<DeltaEntry> Chain
);

public record DeltaEntry(
    [property: JsonPropertyName("fromVersion")]
    string FromVersion,

    [property: JsonPropertyName("toVersion")]
    string ToVersion,

    [property: JsonPropertyName("url")]
    string Url,

    [property: JsonPropertyName("hash")]
    string Hash,

    [property: JsonPropertyName("size")]
    long Size
);
