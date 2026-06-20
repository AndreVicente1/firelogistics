using FireLogistics.Core.Infrastructure;
using FireLogistics.Core.World.Terrain;
using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

public partial class Main : Node3D
{
    private Control? _webView;
    private LocalWebServer? _webServer;
    private Label? _fallbackStatus;
    private TerrainRenderState? _terrainRenderState;
    private Mesh? _terrainLineMesh;
    private string _terrainStatusText = "Relief procedural de secours";
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
            Position = new Vector3(0, 34, 50),
            RotationDegrees = new Vector3(-44, 0, 0),
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

        var terrain = new MeshInstance3D
        {
            Name = "TacticalTerrain",
            Mesh = CreateTerrainMesh(),
            MaterialOverride = CreateTerrainMaterial()
        };
        AddChild(terrain);

        if (_terrainLineMesh != null)
        {
            var reliefLines = new MeshInstance3D
            {
                Name = "TacticalTerrainReliefLines",
                Mesh = _terrainLineMesh,
                MaterialOverride = CreateTerrainLineMaterial(),
                Position = new Vector3(0, 0.05f, 0)
            };
            AddChild(reliefLines);
        }

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
                Position = PlaceOnTerrain(-4 + i * 1.7f, -2 + MathF.Sin(i) * 1.2f, 0.7f)
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
            Position = PlaceOnTerrain(5, 4, 0.35f)
        };
        AddChild(vehicle);

        CreateTacticalOverlay();
    }

    private static StandardMaterial3D CreateTerrainMaterial()
    {
        return new StandardMaterial3D
        {
            AlbedoColor = new Color(0.14f, 0.29f, 0.18f),
            Roughness = 0.92f
        };
    }

    private static StandardMaterial3D CreateTerrainLineMaterial()
    {
        return new StandardMaterial3D
        {
            AlbedoColor = new Color(0.82f, 0.98f, 0.72f, 0.62f),
            ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
            Transparency = BaseMaterial3D.TransparencyEnum.Alpha
        };
    }

    private Mesh CreateTerrainMesh()
    {
        if (TryLoadConfiguredTerrain(out TerrainHeightChunk? chunk, out float verticalScale, out float metersToGodotUnit))
        {
            GD.Print($"Terrain FLHT charge: {chunk.Width}x{chunk.Height}, cell={chunk.CellSizeMeters}m, verticalScale={verticalScale:0.##}x");
            _terrainStatusText = $"Relief 3D FLHT actif - {chunk.Width}x{chunk.Height} - echelle verticale {verticalScale:0.##}x";
            return BuildTerrainMesh(chunk, verticalScale, metersToGodotUnit);
        }

        GD.Print("Aucun chunk terrain FLHT trouve. Relief procedural de secours charge.");
        return BuildProceduralFallbackTerrain();
    }

    private bool TryLoadConfiguredTerrain(out TerrainHeightChunk chunk, out float verticalScale, out float metersToGodotUnit)
    {
        chunk = null!;
        verticalScale = 1.8f;
        metersToGodotUnit = 0.025f;

        string indexPath = ProjectSettings.GlobalizePath("res://assets/terrain/index.json");
        if (!File.Exists(indexPath))
        {
            return false;
        }

        try
        {
            TerrainIndex? index = JsonSerializer.Deserialize<TerrainIndex>(File.ReadAllText(indexPath), new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
            TerrainChunkEntry? entry = index?.Chunks is { Count: > 0 } ? index.Chunks[0] : null;
            if (entry == null || string.IsNullOrWhiteSpace(entry.Path))
            {
                return false;
            }

            string chunkPath = ProjectSettings.GlobalizePath("res://assets/terrain/" + entry.Path.Replace('\\', '/'));
            if (!File.Exists(chunkPath))
            {
                GD.PrintErr("Index terrain present mais chunk introuvable: " + chunkPath);
                return false;
            }

            verticalScale = index?.VerticalScale is > 0 ? index.VerticalScale : verticalScale;
            metersToGodotUnit = index?.RenderMetersToGodotUnit is > 0 ? index.RenderMetersToGodotUnit : metersToGodotUnit;
            chunk = FlhtTerrainChunkReader.Read(File.ReadAllBytes(chunkPath));
            return true;
        }
        catch (Exception ex)
        {
            GD.PrintErr("Chargement terrain FLHT impossible: " + ex.Message);
            return false;
        }
    }

    private Mesh BuildTerrainMesh(TerrainHeightChunk chunk, float verticalScale, float metersToGodotUnit)
    {
        int vertexCount = chunk.Width * chunk.Height;
        var vertices = new Vector3[vertexCount];
        var normals = new Vector3[vertexCount];
        var indices = new int[(chunk.Width - 1) * (chunk.Height - 1) * 6];
        float localMinElevation = chunk.MinElevationMeters;

        for (int y = 0; y < chunk.Height; y++)
        {
            for (int x = 0; x < chunk.Width; x++)
            {
                int i = y * chunk.Width + x;
                float px = (chunk.OriginXMeters + x * chunk.CellSizeMeters) * metersToGodotUnit;
                float pz = (chunk.OriginZMeters + y * chunk.CellSizeMeters) * metersToGodotUnit;
                float py = (chunk.ElevationsMeters[i] - localMinElevation) * metersToGodotUnit * verticalScale;
                vertices[i] = new Vector3(px, py, pz);
            }
        }

        int offset = 0;
        for (int y = 0; y < chunk.Height - 1; y++)
        {
            for (int x = 0; x < chunk.Width - 1; x++)
            {
                int i00 = y * chunk.Width + x;
                int i10 = i00 + 1;
                int i01 = i00 + chunk.Width;
                int i11 = i01 + 1;

                indices[offset++] = i00;
                indices[offset++] = i01;
                indices[offset++] = i10;
                indices[offset++] = i10;
                indices[offset++] = i01;
                indices[offset++] = i11;
            }
        }

        AccumulateNormals(vertices, indices, normals);
        _terrainRenderState = new TerrainRenderState(chunk, verticalScale, metersToGodotUnit);
        _terrainLineMesh = BuildTerrainLineMesh(vertices, chunk.Width, chunk.Height, step: 4);
        return BuildArrayMesh(vertices, normals, indices);
    }

    private Mesh BuildProceduralFallbackTerrain()
    {
        const int size = 65;
        const float spacing = 0.65f;
        var elevations = new float[size * size];
        float minElevation = float.MaxValue;
        float maxElevation = float.MinValue;

        for (int z = 0; z < size; z++)
        {
            for (int x = 0; x < size; x++)
            {
                float centeredX = (x - (size - 1) * 0.5f) * spacing;
                float centeredZ = (z - (size - 1) * 0.5f) * spacing;
                float ridge = MathF.Sin(centeredX * 0.32f) * 2.2f + MathF.Cos(centeredZ * 0.24f) * 1.8f;
                float valley = -MathF.Exp(-(centeredX * centeredX + centeredZ * centeredZ) / 170f) * 2.8f;
                float elevation = ridge + valley + MathF.Sin((centeredX + centeredZ) * 0.18f);
                int i = z * size + x;
                elevations[i] = elevation;
                minElevation = MathF.Min(minElevation, elevation);
                maxElevation = MathF.Max(maxElevation, elevation);
            }
        }

        var chunk = new TerrainHeightChunk(
            width: size,
            height: size,
            cellSizeMeters: spacing,
            originXMeters: -(size - 1) * spacing * 0.5f,
            originZMeters: -(size - 1) * spacing * 0.5f,
            minElevationMeters: minElevation,
            maxElevationMeters: maxElevation,
            elevationsMeters: elevations);

        return BuildTerrainMesh(chunk, verticalScale: 1.0f, metersToGodotUnit: 1.0f);
    }

    private static void AccumulateNormals(Vector3[] vertices, int[] indices, Vector3[] normals)
    {
        for (int i = 0; i < indices.Length; i += 3)
        {
            int ia = indices[i];
            int ib = indices[i + 1];
            int ic = indices[i + 2];
            Vector3 normal = (vertices[ib] - vertices[ia]).Cross(vertices[ic] - vertices[ia]).Normalized();
            normals[ia] += normal;
            normals[ib] += normal;
            normals[ic] += normal;
        }

        for (int i = 0; i < normals.Length; i++)
        {
            normals[i] = normals[i].LengthSquared() > 0 ? normals[i].Normalized() : Vector3.Up;
        }
    }

    private static Mesh BuildArrayMesh(Vector3[] vertices, Vector3[] normals, int[] indices)
    {
        var arrays = new Godot.Collections.Array();
        arrays.Resize((int)Mesh.ArrayType.Max);
        arrays[(int)Mesh.ArrayType.Vertex] = vertices;
        arrays[(int)Mesh.ArrayType.Normal] = normals;
        arrays[(int)Mesh.ArrayType.Index] = indices;

        var mesh = new ArrayMesh();
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
        return mesh;
    }

    private static Mesh BuildTerrainLineMesh(Vector3[] terrainVertices, int width, int height, int step)
    {
        var lineVertices = new List<Vector3>();
        int stride = Math.Max(1, step);

        for (int y = 0; y < height; y += stride)
        {
            for (int x = 0; x < width - 1; x++)
            {
                lineVertices.Add(terrainVertices[y * width + x]);
                lineVertices.Add(terrainVertices[y * width + x + 1]);
            }
        }

        for (int x = 0; x < width; x += stride)
        {
            for (int y = 0; y < height - 1; y++)
            {
                lineVertices.Add(terrainVertices[y * width + x]);
                lineVertices.Add(terrainVertices[(y + 1) * width + x]);
            }
        }

        var arrays = new Godot.Collections.Array();
        arrays.Resize((int)Mesh.ArrayType.Max);
        arrays[(int)Mesh.ArrayType.Vertex] = lineVertices.ToArray();

        var mesh = new ArrayMesh();
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Lines, arrays);
        return mesh;
    }

    private void CreateTacticalOverlay()
    {
        var canvas = new CanvasLayer { Name = "TacticalOverlayLayer" };
        AddChild(canvas);

        var panel = new PanelContainer
        {
            AnchorLeft = 0.66f,
            AnchorTop = 0,
            AnchorRight = 1,
            AnchorBottom = 0,
            OffsetLeft = 16,
            OffsetTop = 16,
            OffsetRight = -16,
            OffsetBottom = 112
        };
        canvas.AddChild(panel);

        var box = new VBoxContainer();
        panel.AddChild(box);
        box.AddChild(new Label { Text = "VUE TACTIQUE 3D", HorizontalAlignment = HorizontalAlignment.Center });
        box.AddChild(new Label
        {
            Text = _terrainStatusText,
            AutowrapMode = TextServer.AutowrapMode.WordSmart
        });
    }

    private Vector3 PlaceOnTerrain(float x, float z, float yOffset)
    {
        return new Vector3(x, SampleRenderedTerrainHeight(x, z) + yOffset, z);
    }

    private float SampleRenderedTerrainHeight(float x, float z)
    {
        if (_terrainRenderState == null)
        {
            return 0;
        }

        return _terrainRenderState.SampleRenderedHeight(x, z);
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

    private sealed class TerrainIndex
    {
        public float VerticalScale { get; set; } = 1.8f;

        public float RenderMetersToGodotUnit { get; set; } = 0.025f;

        public List<TerrainChunkEntry> Chunks { get; set; } = new();
    }

    private sealed class TerrainChunkEntry
    {
        public string Path { get; set; } = string.Empty;
    }

    private sealed class TerrainRenderState
    {
        private readonly TerrainHeightChunk _chunk;
        private readonly float _verticalScale;
        private readonly float _metersToGodotUnit;

        public TerrainRenderState(TerrainHeightChunk chunk, float verticalScale, float metersToGodotUnit)
        {
            _chunk = chunk;
            _verticalScale = verticalScale;
            _metersToGodotUnit = metersToGodotUnit;
        }

        public float SampleRenderedHeight(float worldX, float worldZ)
        {
            float sourceX = worldX / _metersToGodotUnit - _chunk.OriginXMeters;
            float sourceZ = worldZ / _metersToGodotUnit - _chunk.OriginZMeters;
            int gridX = Mathf.Clamp((int)MathF.Round(sourceX / _chunk.CellSizeMeters), 0, _chunk.Width - 1);
            int gridZ = Mathf.Clamp((int)MathF.Round(sourceZ / _chunk.CellSizeMeters), 0, _chunk.Height - 1);
            float sourceElevation = _chunk.GetElevationMeters(gridX, gridZ) - _chunk.MinElevationMeters;
            return sourceElevation * _metersToGodotUnit * _verticalScale;
        }
    }
}
