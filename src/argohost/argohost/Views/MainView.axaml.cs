namespace Argon.Views;

using Avalonia.Controls;
using System.ComponentModel;
using WebViewControl;
using System;
using System.Reactive;
using Avalonia.Input;
using Avalonia.Threading;
using ReactiveUI;
using Xilium.CefGlue;

public partial class MainView : UserControl
{
    public MainView()
    {
        InitializeComponent();
        DataContext = new MainWindowViewModel(this.FindControl<WebView>("webview"));
    }

    private void OnTitleBarPointerPressed(object sender, PointerPressedEventArgs e)
    {
        if (this.VisualRoot is Window window) window.BeginMoveDrag(e);
    }
}
class MainWindowViewModel : ReactiveObject
{
    private readonly WebView _webview;

    public MainWindowViewModel()  { }
    private string address;
    private string currentAddress;

    public MainWindowViewModel(WebView webview)
    {
        _webview = webview;
        Address = CurrentAddress = "http://localhost:5173";

        webview.DisableBuiltinContextMenus = true;
        webview.DisableFileDialogs = true;

        webview.KeyUp += OnKeyUp;

        NavigateCommand = ReactiveCommand.Create(() => {
            CurrentAddress = Address;
        });

        ShowDevToolsCommand = ReactiveCommand.Create(webview.ShowDeveloperTools);
        CutCommand = ReactiveCommand.Create(webview.EditCommands.Cut);
        CopyCommand = ReactiveCommand.Create(webview.EditCommands.Copy);
        PasteCommand = ReactiveCommand.Create(webview.EditCommands.Paste);
        UndoCommand = ReactiveCommand.Create(webview.EditCommands.Undo);
        RedoCommand = ReactiveCommand.Create(webview.EditCommands.Redo);
        SelectAllCommand = ReactiveCommand.Create(webview.EditCommands.SelectAll);
        DeleteCommand = ReactiveCommand.Create(webview.EditCommands.Delete);
        BackCommand = ReactiveCommand.Create(webview.GoBack);
        ForwardCommand = ReactiveCommand.Create(webview.GoForward);

        PropertyChanged += OnPropertyChanged!;
    }

    private bool IsDevToolsOpened;
    private void OnKeyUp(object? sender, KeyEventArgs e)
    {
        if (e.Key != Key.F11) return;
        if (!IsDevToolsOpened)
            _webview.ShowDeveloperTools();
        else 
            _webview.CloseDeveloperTools();
        IsDevToolsOpened = !IsDevToolsOpened;
    }

    private void OnPropertyChanged(object sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(CurrentAddress)) 
            return;
        Address = CurrentAddress;
    }


    public string Address
    {
        get => address;
        set => this.RaiseAndSetIfChanged(ref address, value);
    }

    public string CurrentAddress
    {
        get => currentAddress;
        set => this.RaiseAndSetIfChanged(ref currentAddress, value);
    }

    public ReactiveCommand<Unit, Unit> MinimizeCommand { get; }
    public ReactiveCommand<Unit, Unit> MaximizeCommand { get; }
    public ReactiveCommand<Unit, Unit> CloseCommand { get; }
    
    public ReactiveCommand<Unit, Unit> NavigateCommand { get; }

    public ReactiveCommand<Unit, Unit> ShowDevToolsCommand { get; }

    public ReactiveCommand<Unit, Unit> CutCommand { get; }

    public ReactiveCommand<Unit, Unit> CopyCommand { get; }

    public ReactiveCommand<Unit, Unit> PasteCommand { get; }

    public ReactiveCommand<Unit, Unit> UndoCommand { get; }

    public ReactiveCommand<Unit, Unit> RedoCommand { get; }

    public ReactiveCommand<Unit, Unit> SelectAllCommand { get; }

    public ReactiveCommand<Unit, Unit> DeleteCommand { get; }

    public ReactiveCommand<Unit, Unit> BackCommand { get; }

    public ReactiveCommand<Unit, Unit> ForwardCommand { get; }
}