using FireLogistics.Core.Infrastructure;
using Godot;
using System;

public sealed class WebViewHost : IDisposable
{
    private readonly LocalWebServer _webServer;

    private WebViewHost(LocalWebServer webServer)
    {
        _webServer = webServer;
    }

    public static bool CanCreateWebView()
    {
        return ClassDB.ClassExists("WebView")
            && !string.Equals(DisplayServer.GetName(), "headless", StringComparison.OrdinalIgnoreCase);
    }

    public static WebViewHost Create(Node owner, WebBridge bridge)
    {
        var webView = (Control)ClassDB.Instantiate("WebView");
        string webRoot = ResolveWebRoot();
        var webServer = new LocalWebServer(webRoot);
        string url = webServer.BaseUrl + "index.html";

        bridge.AttachWebView(webView);
        webView.Set("full_window_size", false);
        webView.Set("url", url);
        webView.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        webView.Connect("ipc_message", new Callable(bridge, nameof(WebBridge.OnWebViewMessage)));
        webView.Connect("page_load_finished", new Callable(bridge, nameof(WebBridge.OnWebViewPageLoadFinished)));

        var canvas = new CanvasLayer { Name = "WebViewLayer" };
        owner.AddChild(canvas);
        canvas.AddChild(webView);

        GD.Print("Serveur web local demarre: " + webServer.BaseUrl);
        GD.Print("WebView initialise avec l'URL: " + url);
        return new WebViewHost(webServer);
    }

    public void Dispose()
    {
        _webServer.Dispose();
    }

    private static string ResolveWebRoot()
    {
        string? executablePath = OS.GetExecutablePath();
        if (!string.IsNullOrWhiteSpace(executablePath))
        {
            string? executableDir = System.IO.Path.GetDirectoryName(executablePath);
            string? bundled = ExportedRuntimePaths.TryResolveBundledWebRoot(executableDir);
            if (bundled != null)
            {
                return bundled;
            }
        }

        return ProjectSettings.GlobalizePath("res://assets/web");
    }
}
