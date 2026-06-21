using Godot;
using System;

public partial class Main : Node3D
{
    private TacticalSceneController? _tacticalScene;
    private WebBridge? _webBridge;
    private WebViewHost? _webViewHost;
    private double _metricsTimer;

    public override void _Ready()
    {
        GD.Print("Fire Logistics - Initialisation...");
        ConfigureWebViewProfile();

        _tacticalScene = new TacticalSceneController(this);
        _tacticalScene.Create();

        _webBridge = new WebBridge();
        AddChild(_webBridge);

        if (WebViewHost.CanCreateWebView())
        {
            _webViewHost = WebViewHost.Create(this, _webBridge);
            return;
        }

        GD.PrintErr("Godot WRY indisponible ou runtime headless. Affichage du HUD natif de secours.");
        NativeFallbackOverlay.Create(this);
    }

    public override void _ExitTree()
    {
        _webViewHost?.Dispose();
        _webViewHost = null;
    }

    public override void _Process(double delta)
    {
        _metricsTimer += delta;
        if (_metricsTimer < 0.5)
        {
            return;
        }

        _metricsTimer = 0;
        _webBridge?.PushRuntimeMetricsToWeb();
    }

    private static void ConfigureWebViewProfile()
    {
        string tempPath = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(),
            "FireLogistics_WebView2_" + Guid.NewGuid());
        System.Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", tempPath);
    }
}
