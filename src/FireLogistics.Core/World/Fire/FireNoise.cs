namespace FireLogistics.Core.World.Fire;

internal static class FireNoise
{
    public static double Value(int x, int y, int seed)
    {
        uint hash = 2166136261;
        hash = Mix(hash, unchecked((uint)x));
        hash = Mix(hash, unchecked((uint)y));
        hash = Mix(hash, unchecked((uint)seed));
        hash ^= hash >> 16;
        hash *= 2246822519;
        hash ^= hash >> 13;
        hash *= 3266489917;
        hash ^= hash >> 16;
        return hash / (double)uint.MaxValue;
    }

    private static uint Mix(uint hash, uint value)
    {
        hash ^= value;
        hash *= 16777619;
        return hash;
    }
}
