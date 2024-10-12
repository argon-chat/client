using Argo.ViewModels;
using Argo.Views;
using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Data.Core;
using Avalonia.Data.Core.Plugins;
using Avalonia.Markup.Xaml;
using AvaloniaWebView;

namespace Argo
{
    using ViewModels;
    using Views;

    public partial class App : Application
    {
        public override void Initialize() => AvaloniaXamlLoader.Load(this);

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
    }
}