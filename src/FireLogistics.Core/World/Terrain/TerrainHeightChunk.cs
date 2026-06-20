namespace FireLogistics.Core.World.Terrain;

public sealed class TerrainHeightChunk
{
    public TerrainHeightChunk(
        int width,
        int height,
        float cellSizeMeters,
        float originXMeters,
        float originZMeters,
        float minElevationMeters,
        float maxElevationMeters,
        float[] elevationsMeters)
    {
        if (width <= 1)
        {
            throw new ArgumentOutOfRangeException(nameof(width), "A terrain chunk needs at least two columns.");
        }

        if (height <= 1)
        {
            throw new ArgumentOutOfRangeException(nameof(height), "A terrain chunk needs at least two rows.");
        }

        if (cellSizeMeters <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(cellSizeMeters), "Cell size must be positive.");
        }

        if (elevationsMeters.Length != width * height)
        {
            throw new ArgumentException("Elevation count must match width * height.", nameof(elevationsMeters));
        }

        Width = width;
        Height = height;
        CellSizeMeters = cellSizeMeters;
        OriginXMeters = originXMeters;
        OriginZMeters = originZMeters;
        MinElevationMeters = minElevationMeters;
        MaxElevationMeters = maxElevationMeters;
        ElevationsMeters = elevationsMeters;
    }

    public int Width { get; }

    public int Height { get; }

    public float CellSizeMeters { get; }

    public float OriginXMeters { get; }

    public float OriginZMeters { get; }

    public float MinElevationMeters { get; }

    public float MaxElevationMeters { get; }

    public float[] ElevationsMeters { get; }

    public float GetElevationMeters(int x, int y)
    {
        if ((uint)x >= Width)
        {
            throw new ArgumentOutOfRangeException(nameof(x));
        }

        if ((uint)y >= Height)
        {
            throw new ArgumentOutOfRangeException(nameof(y));
        }

        return ElevationsMeters[y * Width + x];
    }
}
