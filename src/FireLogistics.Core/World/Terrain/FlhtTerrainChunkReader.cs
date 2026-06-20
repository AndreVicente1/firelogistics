using System.Buffers.Binary;
using System.Text;

namespace FireLogistics.Core.World.Terrain;

public static class FlhtTerrainChunkReader
{
    public const ushort CurrentVersion = 1;

    private const int HeaderSize =
        4 + // magic
        2 + // version
        2 + // flags
        4 + // width
        4 + // height
        4 + // cell size
        4 + // origin x
        4 + // origin z
        4 + // elevation scale
        4 + // min elevation
        4;  // max elevation

    public static TerrainHeightChunk Read(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length < HeaderSize)
        {
            throw new InvalidDataException("FLHT chunk is shorter than its header.");
        }

        if (!bytes[..4].SequenceEqual("FLHT"u8))
        {
            throw new InvalidDataException("Invalid FLHT magic.");
        }

        ushort version = BinaryPrimitives.ReadUInt16LittleEndian(bytes[4..6]);
        if (version != CurrentVersion)
        {
            throw new InvalidDataException($"Unsupported FLHT version {version}.");
        }

        int width = BinaryPrimitives.ReadInt32LittleEndian(bytes[8..12]);
        int height = BinaryPrimitives.ReadInt32LittleEndian(bytes[12..16]);
        float cellSizeMeters = ReadSingle(bytes[16..20]);
        float originXMeters = ReadSingle(bytes[20..24]);
        float originZMeters = ReadSingle(bytes[24..28]);
        float elevationScaleMeters = ReadSingle(bytes[28..32]);
        float minElevationMeters = ReadSingle(bytes[32..36]);
        float maxElevationMeters = ReadSingle(bytes[36..40]);

        if (width <= 1 || height <= 1)
        {
            throw new InvalidDataException("FLHT dimensions must be greater than 1.");
        }

        if (cellSizeMeters <= 0 || elevationScaleMeters <= 0)
        {
            throw new InvalidDataException("FLHT scale values must be positive.");
        }

        int sampleCount = checked(width * height);
        int expectedBytes = HeaderSize + checked(sampleCount * 4);
        if (bytes.Length != expectedBytes)
        {
            throw new InvalidDataException($"FLHT byte count mismatch. Expected {expectedBytes}, got {bytes.Length}.");
        }

        var elevations = new float[sampleCount];
        int offset = HeaderSize;
        for (int i = 0; i < elevations.Length; i++)
        {
            elevations[i] = ReadSingle(bytes[offset..(offset + 4)]) * elevationScaleMeters;
            offset += 4;
        }

        return new TerrainHeightChunk(
            width,
            height,
            cellSizeMeters,
            originXMeters,
            originZMeters,
            minElevationMeters * elevationScaleMeters,
            maxElevationMeters * elevationScaleMeters,
            elevations);
    }

    public static byte[] Write(TerrainHeightChunk chunk)
    {
        byte[] bytes = new byte[HeaderSize + chunk.ElevationsMeters.Length * 4];
        Encoding.ASCII.GetBytes("FLHT", bytes);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(4, 2), CurrentVersion);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(6, 2), 0);
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(8, 4), chunk.Width);
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(12, 4), chunk.Height);
        WriteSingle(bytes.AsSpan(16, 4), chunk.CellSizeMeters);
        WriteSingle(bytes.AsSpan(20, 4), chunk.OriginXMeters);
        WriteSingle(bytes.AsSpan(24, 4), chunk.OriginZMeters);
        WriteSingle(bytes.AsSpan(28, 4), 1.0f);
        WriteSingle(bytes.AsSpan(32, 4), chunk.MinElevationMeters);
        WriteSingle(bytes.AsSpan(36, 4), chunk.MaxElevationMeters);

        int offset = HeaderSize;
        foreach (float elevation in chunk.ElevationsMeters)
        {
            WriteSingle(bytes.AsSpan(offset, 4), elevation);
            offset += 4;
        }

        return bytes;
    }

    private static float ReadSingle(ReadOnlySpan<byte> bytes)
    {
        int raw = BinaryPrimitives.ReadInt32LittleEndian(bytes);
        return BitConverter.Int32BitsToSingle(raw);
    }

    private static void WriteSingle(Span<byte> bytes, float value)
    {
        BinaryPrimitives.WriteInt32LittleEndian(bytes, BitConverter.SingleToInt32Bits(value));
    }
}
