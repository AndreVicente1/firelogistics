using Godot;
using System;

public sealed class TacticalSceneController
{
    private readonly Node3D _owner;
    private TerrainMeshResult? _terrain;

    public TacticalSceneController(Node3D owner)
    {
        _owner = owner;
    }

    public void Create()
    {
        _terrain = TerrainMeshBuilder.CreateConfiguredOrFallback();
        CreateCamera();
        CreateLight();
        CreateTerrain();
        CreatePlaceholders();
        CreateOverlay();
    }

    private void CreateCamera()
    {
        _owner.AddChild(new Camera3D
        {
            Name = "TacticalCamera",
            Position = new Vector3(0, 34, 50),
            RotationDegrees = new Vector3(-44, 0, 0),
            Current = true
        });
    }

    private void CreateLight()
    {
        _owner.AddChild(new DirectionalLight3D
        {
            Name = "Sun",
            RotationDegrees = new Vector3(-55, -35, 0),
            LightEnergy = 2.2f
        });
    }

    private void CreateTerrain()
    {
        if (_terrain == null)
        {
            return;
        }

        _owner.AddChild(new MeshInstance3D
        {
            Name = "TacticalTerrain",
            Mesh = _terrain.Mesh,
            MaterialOverride = CreateTerrainMaterial()
        });

        if (_terrain.LineMesh != null)
        {
            _owner.AddChild(new MeshInstance3D
            {
                Name = "TacticalTerrainReliefLines",
                Mesh = _terrain.LineMesh,
                MaterialOverride = CreateTerrainLineMaterial(),
                Position = new Vector3(0, 0.05f, 0)
            });
        }
    }

    private void CreatePlaceholders()
    {
        var fireMaterial = new StandardMaterial3D
        {
            AlbedoColor = new Color(1.0f, 0.28f, 0.05f),
            EmissionEnabled = true,
            Emission = new Color(1.0f, 0.18f, 0.02f),
            EmissionEnergyMultiplier = 1.6f
        };

        for (int i = 0; i < 5; i++)
        {
            _owner.AddChild(new MeshInstance3D
            {
                Name = $"FireCellPlaceholder{i}",
                Mesh = new CylinderMesh { TopRadius = 0.1f, BottomRadius = 0.45f, Height = 1.4f },
                MaterialOverride = fireMaterial,
                Position = PlaceOnTerrain(-4 + i * 1.7f, -2 + MathF.Sin(i) * 1.2f, 0.7f)
            });
        }

        _owner.AddChild(new MeshInstance3D
        {
            Name = "CcfPlaceholder",
            Mesh = new BoxMesh { Size = new Vector3(1.4f, 0.7f, 2.4f) },
            MaterialOverride = new StandardMaterial3D
            {
                AlbedoColor = new Color(0.85f, 0.08f, 0.05f),
                Roughness = 0.55f
            },
            Position = PlaceOnTerrain(5, 4, 0.35f)
        });
    }

    private void CreateOverlay()
    {
        var canvas = new CanvasLayer { Name = "TacticalOverlayLayer" };
        _owner.AddChild(canvas);

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
            Text = _terrain?.StatusText ?? "Relief procedural de secours",
            AutowrapMode = TextServer.AutowrapMode.WordSmart
        });
    }

    private Vector3 PlaceOnTerrain(float x, float z, float yOffset)
    {
        return new Vector3(x, (_terrain?.SampleRenderedHeight(x, z) ?? 0) + yOffset, z);
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
}
