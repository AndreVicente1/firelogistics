using FireLogistics.Core.Infrastructure;
using Godot;
using System;
using System.Text.Json;

public partial class Main : Node3D
{
    private Control? _webView;
    private LocalWebServer? _webServer;
    private Label? _fallbackStatus;
    private double _metricsTimer;

    public override void _Ready()
    {
        GD.Print("Fire Logistics - Initialisation...");
        string tempPath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "FireLogistics_WebView2_" + Guid.NewGuid());
        System.Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", tempPath);

        CreateTacticalScene();

        if (ClassDB.ClassExists("WebView"))
        {
            CreateWebView();
        }
        else
        {
            GD.PrintErr("Godot WRY indisponible. Affichage du HUD natif de secours.");
            CreateNativeFallback();
        }
    }

    public override void _ExitTree()
    {
        _webServer?.Dispose();
        _webServer = null;
    }

    public override void _Process(double delta)
    {
        _metricsTimer += delta;
        if (_metricsTimer < 0.5)
        {
            return;
        }

        _metricsTimer = 0;
        PushRuntimeMetricsToWeb();
    }

    private void CreateTacticalScene()
    {
        var camera = new Camera3D
        {
            Name = "TacticalCamera",
            Position = new Vector3(0, 18, 24),
            RotationDegrees = new Vector3(-38, 0, 0),
            Current = true
        };
        AddChild(camera);

        var light = new DirectionalLight3D
        {
            Name = "Sun",
            RotationDegrees = new Vector3(-55, -35, 0),
            LightEnergy = 2.2f
        };
        AddChild(light);

        var terrainMaterial = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.12f, 0.22f, 0.16f),
            Roughness = 0.9f
        };
        var terrain = new MeshInstance3D
        {
            Name = "TacticalTerrainPlaceholder",
            Mesh = new PlaneMesh { Size = new Vector2(42, 42) },
            MaterialOverride = terrainMaterial
        };
        AddChild(terrain);

        var fireMaterial = new StandardMaterial3D
        {
            AlbedoColor = new Color(1.0f, 0.28f, 0.05f),
            EmissionEnabled = true,
            Emission = new Color(1.0f, 0.18f, 0.02f),
            EmissionEnergyMultiplier = 1.6f
        };
        for (int i = 0; i < 5; i++)
        {
            var flame = new MeshInstance3D
            {
                Name = $"FireCellPlaceholder{i}",
                Mesh = new CylinderMesh { TopRadius = 0.1f, BottomRadius = 0.45f, Height = 1.4f },
                MaterialOverride = fireMaterial,
                Position = new Vector3(-4 + i * 1.7f, 0.7f, -2 + MathF.Sin(i) * 1.2f)
            };
            AddChild(flame);
        }

        var vehicleMaterial = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.85f, 0.08f, 0.05f),
            Roughness = 0.55f
        };
        var vehicle = new MeshInstance3D
        {
            Name = "CcfPlaceholder",
            Mesh = new BoxMesh { Size = new Vector3(1.4f, 0.7f, 2.4f) },
            MaterialOverride = vehicleMaterial,
            Position = new Vector3(5, 0.35f, 4)
        };
        AddChild(vehicle);
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

    private void CreateWebView()
    {
        _webView = (Control)ClassDB.Instantiate("WebView");
        string webRoot = ResolveWebRoot();
        _webServer = new LocalWebServer(webRoot);
        string url = _webServer.BaseUrl + "index.html";

        _webView.Set("full_window_size", false);
        _webView.Set("url", url);
        _webView.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        _webView.Connect("ipc_message", new Callable(this, MethodName.OnWebViewMessage));
        _webView.Connect("page_load_finished", new Callable(this, MethodName.OnWebViewPageLoadFinished));

        var canvas = new CanvasLayer { Name = "WebViewLayer" };
        AddChild(canvas);
        canvas.AddChild(_webView);

        GD.Print("Serveur web local demarre: " + _webServer.BaseUrl);
        GD.Print("WebView initialise avec l'URL: " + url);
    }

    private void CreateNativeFallback()
    {
        var canvas = new CanvasLayer { Name = "NativeFallbackLayer" };
        AddChild(canvas);

        var panel = new PanelContainer
        {
            AnchorLeft = 0,
            AnchorTop = 0,
            AnchorRight = 0,
            AnchorBottom = 0,
            OffsetLeft = 16,
            OffsetTop = 16,
            OffsetRight = 420,
            OffsetBottom = 160
        };
        canvas.AddChild(panel);

        var box = new VBoxContainer();
        panel.AddChild(box);
        box.AddChild(new Label { Text = "FIRE LOGISTICS", HorizontalAlignment = HorizontalAlignment.Center });
        _fallbackStatus = new Label
        {
            Text = "Carte WebView indisponible. La scene 3D native est chargee.",
            AutowrapMode = TextServer.AutowrapMode.WordSmart
        };
        box.AddChild(_fallbackStatus);
    }

    private void OnWebViewPageLoadFinished(string url)
    {
        GD.Print("WebView page chargee: " + url);
        PushRuntimeMetricsToWeb();
    }

    private void OnWebViewMessage(string message)
    {
        try
        {
            var dict = Json.ParseString(message).AsGodotDictionary();
            if (!dict.TryGetValue("action", out Variant actionVar))
            {
                return;
            }

            string action = actionVar.AsString();
            if (action == "diagnostics_log")
            {
                string payload = dict.TryGetValue("payload", out Variant payloadVar)
                    ? payloadVar.AsString()
                    : string.Empty;
                GD.Print("[Web diagnostics] " + payload);
            }
            else if (action == "quit_game")
            {
                GetTree().Quit();
            }
        }
        catch (Exception ex)
        {
            GD.PrintErr($"[JS -> C#] Message invalide: {message}. Exception: {ex.Message}");
        }
    }

    private void PushRuntimeMetricsToWeb()
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
