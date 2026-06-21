namespace FireLogistics.Core.World.Fire;

public sealed class BurnScarStore
{
    private readonly Dictionary<FireGridCoordinate, FuelType> _cells = [];
    private readonly HashSet<FireGridCoordinate> _pending = [];
    private bool _requiresReset = true;

    public int Count => _cells.Count;
    public int Revision { get; private set; } = 1;
    public IReadOnlyDictionary<FireGridCoordinate, FuelType> Cells => _cells;

    public bool Contains(FireGridCoordinate coordinate) => _cells.ContainsKey(coordinate);

    public bool Add(FireCell cell)
    {
        FuelBehavior behavior = FuelBehavior.For(cell.Fuel);
        if (!behavior.Burnable || _cells.ContainsKey(cell.Coordinate))
        {
            return false;
        }

        _cells[cell.Coordinate] = cell.Fuel;
        _pending.Add(cell.Coordinate);
        Revision++;
        return true;
    }

    public bool Remove(FireGridCoordinate coordinate)
    {
        if (!_cells.Remove(coordinate))
        {
            return false;
        }

        _pending.Remove(coordinate);
        _requiresReset = true;
        Revision++;
        return true;
    }

    public IReadOnlyDictionary<FuelType, int> CountByFuel()
        => _cells.Values
            .GroupBy(fuel => fuel)
            .ToDictionary(group => group.Key, group => group.Count());

    public FireBurnScarPatch CreatePatch(double cellKm)
    {
        IReadOnlyList<FireBurnScarRun> runs = BuildRuns(_requiresReset ? _cells.Keys : _pending);
        return new FireBurnScarPatch(_requiresReset, Revision, cellKm, runs);
    }

    public void MarkPublished()
    {
        _requiresReset = false;
        _pending.Clear();
    }

    private IReadOnlyList<FireBurnScarRun> BuildRuns(IEnumerable<FireGridCoordinate> coordinates)
    {
        return coordinates
            .Where(coordinate => _cells.ContainsKey(coordinate))
            .GroupBy(coordinate => new { coordinate.Y, Fuel = _cells[coordinate] })
            .OrderBy(group => group.Key.Y)
            .ThenBy(group => group.Key.Fuel)
            .SelectMany(group =>
            {
                List<int> xs = group.Select(coordinate => coordinate.X).Order().ToList();
                var runs = new List<FireBurnScarRun>();
                int? start = null;
                int? previous = null;
                foreach (int x in xs)
                {
                    if (start == null)
                    {
                        start = x;
                        previous = x;
                        continue;
                    }

                    if (x == previous + 1)
                    {
                        previous = x;
                        continue;
                    }

                    runs.Add(new FireBurnScarRun(group.Key.Y, start.Value, previous!.Value, ToWireName(group.Key.Fuel)));
                    start = x;
                    previous = x;
                }

                if (start != null)
                {
                    runs.Add(new FireBurnScarRun(group.Key.Y, start.Value, previous!.Value, ToWireName(group.Key.Fuel)));
                }

                return runs;
            })
            .ToList();
    }

    private static string ToWireName(FuelType fuel) => fuel switch
    {
        FuelType.Water => "water",
        FuelType.Mineral => "mineral",
        FuelType.Crops => "crops",
        FuelType.Grass => "grass",
        FuelType.Scrub => "scrub",
        FuelType.Forest => "forest",
        FuelType.Urban => "urban",
        _ => throw new ArgumentOutOfRangeException(nameof(fuel), fuel, null)
    };
}
