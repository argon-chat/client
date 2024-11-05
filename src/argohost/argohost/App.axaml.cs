namespace Argon;

using System;
using System.Collections.Generic;
using System.Diagnostics;
using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using System.Drawing;
using Avalonia.Input;
using ViewModels;
using Views;
using WebViewControl;

public partial class App : Application
{
    private static readonly List<string> Switches =
    [
        "single-process",
        "enable-gpu",
        "enable-gpu-rasterization",
        "disable-extensions",
        "disable-software-rasterizer",
        "no-proxy-server",
        "disable-bundled-ppapi-flash",
        //"force-fieldtrials=WebRTC-H264HighProfile/Enabled/"
        "disable-renderer-accessibility",
        "disable-site-isolation-trials",
        //disable-gpu-compositing
        //enable-low-end-device-mode
        "disable-offer-store-unmasked-wallet-cards",
        "memory-pressure-on", // TODO settings
        "force-high-performance-gpu", // TODO
        "no-sandbox",
        "disable-backing-store-limit", // TODO
        "disable-web-security",
        "disable-sync",
        "disable-breakpad",
        "disable-print-preview",
        "enable-fast-unload",
        "disable-software-video-decoders",
        "disable-component-update",
        "no-zygote",
        "disable-logging",
        "no-default-browser-check",
        "disable-in-process-stack-traces",
        "disable-cast",
        "disable-plugins",
        "enable-native-gpu-memory-buffers",
        "disable-hang-monitor",
        "disable-infobars",
        "disable-translate",
        "disable-notifications",
        "disable-default-apps",
        "disable-speech-api",
        "disable-speech-synthesis-api",
        "disable-gamepad-api",
        "disable-motion-sensors",
        "disable-application-cache",
        "enable-media-stream"
    ];

    public override void Initialize()
    {
        WebView.Settings.OsrEnabled = true;
        WebView.Settings.BackgroundColor = Color.Transparent;
        WebView.Settings.AddCommandLineSwitch("autoplay-policy", "no-user-gesture-required");
        WebView.Settings.AddCommandLineSwitch("touch-events", "disabled");
        WebView.Settings.AddCommandLineSwitch("num-raster-threads", "16");
        foreach (var @switch in Switches) 
            WebView.Settings.AddCommandLineSwitch(@switch, null);
        AvaloniaXamlLoader.Load(this);
    }

    public override void OnFrameworkInitializationCompleted()
    {
        switch (ApplicationLifetime)
        {
            case IClassicDesktopStyleApplicationLifetime desktop:
                desktop.MainWindow = new MainWindow
                {
                    DataContext = new MainViewModel()
                };
                break;
            case ISingleViewApplicationLifetime singleViewPlatform:
                singleViewPlatform.MainView = new MainView
                {
                    DataContext = new MainViewModel()
                };
                break;
        }

        base.OnFrameworkInitializationCompleted();
    }

    private void NativeMenuItem_Restore_OnClick(object? sender, EventArgs e)
    {
        if (Application.Current?.ApplicationLifetime is IClassicDesktopStyleApplicationLifetime
            {
                MainWindow: not null
            } lifetime)
            lifetime.MainWindow.Show();
        else
            Debug.WriteLine($"Failed restore app");
    }

    private void NativeMenuItem_Exit_OnClick(object? sender, EventArgs e)
    {
        if (Application.Current?.ApplicationLifetime is IClassicDesktopStyleApplicationLifetime
            {
                MainWindow: not null
            } lifetime)
            lifetime.Shutdown();
        else
            Debug.WriteLine($"Failed exit app");
    }
}