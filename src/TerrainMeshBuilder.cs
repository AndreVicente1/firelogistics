using FireLogistics.Core.World.Terrain;
using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

public sealed class TerrainMeshResult
{
    public TerrainMeshResult(Mesh mesh, Mesh? lineMesh, TerrainRenderState renderState, string statusText)
    {
        Mesh = mesh;
        LineMesh = lineMesh;
        RenderState = renderState;
        StatusText = statusText;
    }

    public Mesh Mesh { get; }

    public Mesh? LineMesh { get; }

    public TerrainRenderState RenderState { get; }

    public string StatusText { get; }

    public float SampleRenderedHeight(float x, float z)
    {
        return RenderState.SampleRenderedHeight(x, z);
    }
}

public static class TerrainMeshBuilder
{
    public static TerrainMeshResult CreateConfiguredOrFallback()
    {
        if (TryLoadConfiguredTerrain(out TerrainHeightChunk? chunk, out float verticalScale, out float metersToGodotUnit))
        {
            GD.Print($"Terrain FLHT charge: {chunk.Width}x{chunk.Height}, cell={chunk.CellSizeMeters}m, verticalScale={verticalScale:0.##}x");
            string status = $"Relief 3D FLHT actif - {chunk.Width}x{chunk.Height} - echelle verticale {verticalScale:0.##}x";
            return BuildTerrainMesh(chunk, verticalScale, metersToGodotUnit, status);
        }

        GD.Print("Aucun chunk terrain FLHT trouve. Relief procedural de secours charge.");
        TerrainHeightChunk fallbackChunk = CreateProceduralFallbackChunk();
        return BuildTerrainMesh(fallbackChunk, verticalScale: 1.0f, metersToGodotUnit: 1.0f, "Relief procedural de secours");
    }

    private static bool TryLoadConfiguredTerrain(out TerrainHeightChunk chunk, out float verticalScale, out float metersToGodotUnit)
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

    private static TerrainMeshResult BuildTerrainMesh(TerrainHeightChunk chunk, float verticalScale, float metersToGodotUnit, string statusText)
    {
        int vertexCount = chunk.Width * chunk.Height;
        var vertices = new Vector3[vertexCount];
        var normals = new Vector3[vertexCount];
        var indices = new int[(chunk.Width - 1) * (chunk.Height - 1) * 6];

        for (int y = 0; y < chunk.Height; y++)
        {
            for (int x = 0; x < chunk.Width; x++)
            {
                int i = y * chunk.Width + x;
                float px = (chunk.OriginXMeters + x * chunk.CellSizeMeters) * metersToGodotUnit;
                float pz = (chunk.OriginZMeters + y * chunk.CellSizeMeters) * metersToGodotUnit;
                float py = (chunk.ElevationsMeters[i] - chunk.MinElevationMeters) * metersToGodotUnit * verticalScale;
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
        Mesh mesh = BuildArrayMesh(vertices, normals, indices);
        Mesh lineMesh = BuildTerrainLineMesh(vertices, chunk.Width, chunk.Height, step: 4);
        var renderState = new TerrainRenderState(chunk, verticalScale, metersToGodotUnit);
        return new TerrainMeshResult(mesh, lineMesh, renderState, statusText);
    }

    private static TerrainHeightChunk CreateProceduralFallbackChunk()
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

        return new TerrainHeightChunk(
            width: size,
            height: size,
            cellSizeMeters: spacing,
            originXMeters: -(size - 1) * spacing * 0.5f,
            originZMeters: -(size - 1) * spacing * 0.5f,
            minElevationMeters: minElevation,
            maxElevationMeters: maxElevation,
            elevationsMeters: elevations);
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
}

public sealed class TerrainRenderState
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
