namespace FireLogistics.Core.World.Fire;

public sealed record FuelBehavior(
    bool Burnable,
    double Ignition,
    double Spread,
    int BurnTicks,
    int EmberTicks,
    double Flame,
    double Moisture,
    double Resistance,
    double Spotting)
{
    public static FuelBehavior For(FuelType fuel) => fuel switch
    {
        FuelType.Water => new(false, 99, 0, 0, 0, 0, 1, 99, 0),
        FuelType.Mineral => new(false, 99, 0, 0, 0, 0, 1, 99, 0),
        FuelType.Crops => new(true, 0.48, 0.46, 8, 3, 0.5, 0.34, 0.16, 0.03),
        FuelType.Grass => new(true, 0.4, 0.72, 7, 3, 0.58, 0.22, 0.06, 0.05),
        FuelType.Scrub => new(true, 0.5, 0.82, 12, 6, 0.8, 0.16, 0.02, 0.11),
        FuelType.Forest => new(true, 0.58, 0.76, 18, 9, 0.96, 0.19, 0.04, 0.18),
        FuelType.Urban => new(true, 0.92, 0.2, 12, 5, 0.62, 0.42, 0.62, 0.01),
        _ => throw new ArgumentOutOfRangeException(nameof(fuel), fuel, null)
    };
}
