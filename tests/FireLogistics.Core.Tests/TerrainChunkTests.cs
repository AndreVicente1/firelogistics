using FireLogistics.Core.World.Terrain;
using Xunit;

namespace FireLogistics.Core.Tests;

public sealed class TerrainChunkTests
{
    [Fact]
    public void FlhtReaderRoundTripsTerrainChunk()
    {
        var chunk = new TerrainHeightChunk(
            width: 3,
            height: 2,
            cellSizeMeters: 25,
            originXMeters: -25,
            originZMeters: 50,
            minElevationMeters: 10,
            maxElevationMeters: 42,
            elevationsMeters: [10, 12, 20, 24, 36, 42]);

        byte[] bytes = FlhtTerrainChunkReader.Write(chunk);
        TerrainHeightChunk decoded = FlhtTerrainChunkReader.Read(bytes);

        Assert.Equal(3, decoded.Width);
        Assert.Equal(2, decoded.Height);
        Assert.Equal(25, decoded.CellSizeMeters);
        Assert.Equal(-25, decoded.OriginXMeters);
        Assert.Equal(50, decoded.OriginZMeters);
        Assert.Equal(10, decoded.MinElevationMeters);
        Assert.Equal(42, decoded.MaxElevationMeters);
        Assert.Equal([10, 12, 20, 24, 36, 42], decoded.ElevationsMeters);
    }

    [Fact]
    public void FlhtReaderRejectsInvalidMagic()
    {
        byte[] bytes = FlhtTerrainChunkReader.Write(new TerrainHeightChunk(
            width: 2,
            height: 2,
            cellSizeMeters: 10,
            originXMeters: 0,
            originZMeters: 0,
            minElevationMeters: 0,
            maxElevationMeters: 3,
            elevationsMeters: [0, 1, 2, 3]));

        bytes[0] = (byte)'B';

        Assert.Throws<InvalidDataException>(() => FlhtTerrainChunkReader.Read(bytes));
    }
}
