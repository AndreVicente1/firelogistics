namespace FireLogistics.Core.World.Fire;

public sealed class FireEnvironment
{
    public const double DefaultCellKm = 0.18;

    private readonly IReadOnlyDictionary<FireGridCoordinate, FuelType> _fuelOverrides;

    public FireEnvironment(
        double longitude,
        double latitude,
        int incidentSeed,
        IReadOnlyDictionary<FireGridCoordinate, FuelType>? fuelOverrides = null,
        double cellKm = DefaultCellKm)
    {
        Longitude = longitude;
        Latitude = latitude;
        IncidentSeed = incidentSeed;
        CellKm = cellKm;
        _fuelOverrides = fuelOverrides ?? new Dictionary<FireGridCoordinate, FuelType>();
    }

    public double Longitude { get; }
    public double Latitude { get; }
    public int IncidentSeed { get; }
    public double CellKm { get; }
    public double WindX => 0.92;
    public double WindY => 0.39;
    public string WindDirection => "E-NE";
    public int BaseWindSpeedKmh => 28;

    public FuelType SampleFuel(FireGridCoordinate coordinate)
    {
        if (_fuelOverrides.TryGetValue(coordinate, out FuelType fuel))
        {
            return fuel;
        }

        (double xKm, double yKm) = GetLocalKm(coordinate);
        double river = Math.Abs(yKm + 1.08 + Math.Sin((xKm + 0.6) * 1.2) * 0.16);
        if (river < 0.1 && xKm > -4.3 && xKm < 4.2)
        {
            return FuelType.Water;
        }

        double ridgeTrack = Math.Abs(yKm - (xKm * 0.32 - 0.45));
        if (ridgeTrack < 0.07 && xKm > -3.9 && xKm < 4.2)
        {
            return FuelType.Mineral;
        }

        if (Math.Abs(xKm + 3.45) < 0.07 && yKm < 2.1)
        {
            return FuelType.Mineral;
        }

        double villageA = Distance(xKm - 1.75, yKm - 0.42);
        double villageB = Distance(xKm - 2.8, yKm - 0.2);
        double hamlet = Distance(xKm + 1.75, yKm - 1.25);
        if (villageA < 0.44 || villageB < 0.38 || hamlet < 0.34)
        {
            return FuelType.Urban;
        }

        double roughness = FireNoise.Value((int)Math.Round(xKm * 8), (int)Math.Round(yKm * 8), IncidentSeed + 3);
        if ((yKm > 0.22 && xKm < 3.45) || (xKm > 0.55 && yKm > 0.44))
        {
            return roughness > 0.2 ? FuelType.Forest : FuelType.Scrub;
        }

        if (yKm > -0.88 && xKm < 2.1)
        {
            return roughness > 0.32 ? FuelType.Scrub : FuelType.Grass;
        }

        if (xKm < -1.8 && yKm < -0.2)
        {
            return FuelType.Crops;
        }

        if (roughness > 0.7)
        {
            return FuelType.Scrub;
        }

        return yKm < -1.25 ? FuelType.Crops : FuelType.Grass;
    }

    public (double XKm, double YKm) GetLocalKm(FireGridCoordinate coordinate)
        => (coordinate.X * CellKm, coordinate.Y * CellKm);

    public double[] ToLngLat(double xKm, double yKm)
    {
        double lngPerKm = 1 / (111.32 * Math.Max(0.2, Math.Cos(Latitude * Math.PI / 180)));
        double latPerKm = 1 / 110.57;
        return [Longitude + xKm * lngPerKm, Latitude + yKm * latPerKm];
    }

    private static double Distance(double x, double y) => Math.Sqrt(x * x + y * y);
}
