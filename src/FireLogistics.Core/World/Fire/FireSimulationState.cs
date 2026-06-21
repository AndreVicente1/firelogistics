namespace FireLogistics.Core.World.Fire;

public sealed class FireSimulationState
{
    private readonly Dictionary<FireGridCoordinate, FireCell> _cells = [];

    public FireSimulationState(FireEnvironment environment)
    {
        Environment = environment;
        IgniteInitialCells();
    }

    public FireEnvironment Environment { get; }
    public int Step { get; internal set; }
    public IReadOnlyDictionary<FireGridCoordinate, FireCell> Cells => _cells;
    internal Dictionary<FireGridCoordinate, FireCell> MutableCells => _cells;

    public bool IsAlive => _cells.Values.Any(cell =>
        cell.State is FireCellState.Active or FireCellState.Heat or FireCellState.Embers);

    internal FireCell GetOrCreate(FireGridCoordinate coordinate)
    {
        if (_cells.TryGetValue(coordinate, out FireCell? cell))
        {
            return cell;
        }

        cell = new FireCell(coordinate, Environment.SampleFuel(coordinate));
        _cells.Add(coordinate, cell);
        return cell;
    }

    public void ApplyFuelOverrides(IReadOnlyDictionary<FireGridCoordinate, FuelType> fuelOverrides)
    {
        Environment.MergeFuelOverrides(fuelOverrides);
        foreach ((FireGridCoordinate coordinate, FuelType fuel) in fuelOverrides)
        {
            if (_cells.TryGetValue(coordinate, out FireCell? cell))
            {
                cell.ApplyFuel(fuel);
            }
        }
    }

    private void IgniteInitialCells()
    {
        for (int y = -2; y <= 2; y++)
        {
            for (int x = -2; x <= 2; x++)
            {
                var coordinate = new FireGridCoordinate(x, y);
                FireCell cell = GetOrCreate(coordinate);
                FuelBehavior behavior = FuelBehavior.For(cell.Fuel);
                if (!behavior.Burnable || Math.Sqrt(x * x + y * y) * Environment.CellKm >= 0.34)
                {
                    continue;
                }

                cell.State = FireCellState.Active;
                cell.Heat = 1;
                cell.Intensity = behavior.Flame;
            }
        }
    }
}
