using FireLogistics.Core.Bridge;
using FireLogistics.Core.Infrastructure;
using Godot;
using System.Text.Json;

public partial class WebBridge : Node
{
    private Control? _webView;

    public void AttachWebView(Control webView)
    {
        _webView = webView;
    }

    public void OnWebViewPageLoadFinished(string url)
    {
        GD.Print("WebView page chargee: " + url);
        PushRuntimeMetricsToWeb();
    }

    public void OnWebViewMessage(string message)
    {
        if (!WebIpcMessage.TryParse(message, out WebIpcMessage? ipcMessage) || ipcMessage == null)
        {
            GD.PrintErr("[JS -> C#] Message invalide: " + message);
            return;
        }

        if (ipcMessage.Action == "diagnostics_log")
        {
            GD.Print("[Web diagnostics] " + ipcMessage.PayloadAsString());
        }
        else if (ipcMessage.Action == "fire_ignition_selected")
        {
            GD.Print("[Web ignition] " + message);
        }
        else if (ipcMessage.Action == "quit_game")
        {
            GetTree().Quit();
        }
    }

    public void PushRuntimeMetricsToWeb()
    {
        if (_webView == null)
        {
            return;
        }

        int fps = (int)Engine.GetFramesPerSecond();
        long ramBytes = ProcessTreeMemory.GetCurrentProcessWorkingSetBytes();
        string payload = JsonSerializer.Serialize(new { fps, ramBytes });
        _webView.Call("eval", $"if(window.FireLogistics?.updateRuntimeMetrics) window.FireLogistics.updateRuntimeMetrics({payload});");
    }
}
