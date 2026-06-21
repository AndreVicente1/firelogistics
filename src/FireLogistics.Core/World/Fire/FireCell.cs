namespace FireLogistics.Core.World.Fire;

public sealed class FireCell
{
    public FireCell(FireGridCoordinate coordinate, FuelType fuel)
    {
        Coordinate = coordinate;
        Fuel = fuel;
        FuelLoad = FuelBehavior.For(fuel).Burnable ? 1 : 0;
    }

    private FireCell(FireCell source)
    {
        Coordinate = source.Coordinate;
        Fuel = source.Fuel;
        State = source.State;
        Age = source.Age;
        Heat = source.Heat;
        FuelLoad = source.FuelLoad;
        Intensity = source.Intensity;
    }

    public FireGridCoordinate Coordinate { get; }
    public FuelType Fuel { get; }
    public FireCellState State { get; set; }
    public int Age { get; set; }
    public double Heat { get; set; }
    public double FuelLoad { get; set; }
    public double Intensity { get; set; }

    public FireCell Clone() => new(this);
}
