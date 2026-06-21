namespace FireLogistics.Core.World.Fire;

public static class FireFrameBuilder
{
    private static readonly FireCellState[] RenderStates =
    [
        FireCellState.Heat,
        FireCellState.Burned,
        FireCellState.Embers,
        FireCellState.Active
    ];

    public static FireSimulationFrame Build(FireSimulationState state, string? status = null, int revision = 1, string reason = "initial")
    {
        return new FireSimulationFrame(
            state.Step,
            revision,
            reason,
            [state.Environment.Longitude, state.Environment.Latitude],
            state.Environment.IncidentSeed,
            BuildFeatureCollection(state),
            BuildCells(state),
            BuildEmitters(state),
            BuildStats(state),
            new FireWind(
                state.Environment.WindDirection,
                72,
                (int)Math.Round(state.Environment.BaseWindSpeedKmh + Math.Sin(state.Step * 0.18) * 5)),
            status ?? (state.IsAlive ? "running" : "extinguished"));
    }

    private static IReadOnlyList<WireFireCell> BuildCells(FireSimulationState state)
    {
        return state.Cells.Values
            .Where(cell => cell.State is FireCellState.Heat or FireCellState.Active or FireCellState.Embers or FireCellState.Burned)
            .Select(cell => new WireFireCell(
                cell.Coordinate.X,
                cell.Coordinate.Y,
                ToWireName(cell.Fuel),
                ToWireName(cell.State),
                Math.Round(cell.Intensity, 3),
                Math.Round(cell.Heat, 3)))
            .ToList();
    }

    private static FireFeatureCollection BuildFeatureCollection(FireSimulationState state)
    {
        var features = new List<FireFeature>();
        foreach (FireCellState renderState in RenderStates)
        {
            List<FireCell> cells = state.Cells.Values
                .Where(cell => cell.State == renderState)
                .ToList();

            var groupedRuns = ConnectedComponents(cells)
                .SelectMany(BuildHorizontalRuns)
                .GroupBy(DominantFuel);

            foreach (IGrouping<FuelType, List<FireCell>> fuelGroup in groupedRuns)
            {
                List<List<FireCell>> runs = fuelGroup.ToList();
                if (runs.Count == 0)
                {
                    continue;
                }

                List<IReadOnlyList<IReadOnlyList<double[]>>> polygons = runs
                    .Select(run => (IReadOnlyList<IReadOnlyList<double[]>>)[BuildRunRing(state.Environment, run)])
                    .ToList();
                string stateName = ToWireName(renderState);
                features.Add(new FireFeature(
                    "Feature",
                    new FireFeatureProperties(
                        $"{stateName}-{ToWireName(fuelGroup.Key)}",
                        stateName,
                        ToWireName(fuelGroup.Key),
                        Math.Round(runs.SelectMany(run => run).Max(cell => Math.Max(cell.Intensity, cell.Heat)), 3),
                        runs.Sum(run => run.Count)),
                    new FireGeometry("MultiPolygon", polygons)));
            }
        }

        return new FireFeatureCollection("FeatureCollection", features);
    }

    private static IReadOnlyList<double[]> BuildRunRing(FireEnvironment environment, List<FireCell> cells)
    {
        int minX = cells.Min(cell => cell.Coordinate.X);
        int maxX = cells.Max(cell => cell.Coordinate.X);
        int y = cells[0].Coordinate.Y;
        return
        [
            ToLngLat(environment, minX, y),
            ToLngLat(environment, maxX + 1, y),
            ToLngLat(environment, maxX + 1, y + 1),
            ToLngLat(environment, minX, y + 1),
            ToLngLat(environment, minX, y)
        ];
    }

    private static double[] ToLngLat(FireEnvironment environment, int gridX, int gridY)
        => environment.ToLngLat((gridX - 0.5) * environment.CellKm, (gridY - 0.5) * environment.CellKm);

    private static IEnumerable<List<FireCell>> ConnectedComponents(List<FireCell> cells)
    {
        Dictionary<FireGridCoordinate, FireCell> byCoordinate = cells.ToDictionary(cell => cell.Coordinate);
        var visited = new HashSet<FireGridCoordinate>();
        foreach (FireCell cell in cells)
        {
            if (!visited.Add(cell.Coordinate))
            {
                continue;
            }

            var component = new List<FireCell>();
            var queue = new Queue<FireGridCoordinate>();
            queue.Enqueue(cell.Coordinate);
            while (queue.Count > 0)
            {
                FireGridCoordinate coordinate = queue.Dequeue();
                component.Add(byCoordinate[coordinate]);
                foreach (FireGridCoordinate neighbor in FourNeighbors(coordinate))
                {
                    if (byCoordinate.ContainsKey(neighbor) && visited.Add(neighbor))
                    {
                        queue.Enqueue(neighbor);
                    }
                }
            }

            yield return component;
        }
    }

    private static IEnumerable<List<FireCell>> BuildHorizontalRuns(List<FireCell> cells)
    {
        foreach (IGrouping<int, FireCell> row in cells.GroupBy(cell => cell.Coordinate.Y))
        {
            List<FireCell> sorted = row.OrderBy(cell => cell.Coordinate.X).ToList();
            var run = new List<FireCell>();
            int? previousX = null;
            foreach (FireCell cell in sorted)
            {
                if (previousX.HasValue && cell.Coordinate.X != previousX.Value + 1)
                {
                    yield return run;
                    run = [];
                }

                run.Add(cell);
                previousX = cell.Coordinate.X;
            }

            if (run.Count > 0)
            {
                yield return run;
            }
        }
    }

    private static IReadOnlyList<FireEmitter> BuildEmitters(FireSimulationState state)
    {
        return state.Cells.Values
            .Where(cell => cell.State == FireCellState.Active)
            .OrderByDescending(cell => cell.Coordinate.X + cell.Coordinate.Y * 0.35)
            .Take(34)
            .Select((cell, index) =>
            {
                (double xKm, double yKm) = state.Environment.GetLocalKm(cell.Coordinate);
                return new FireEmitter(
                    $"cell-{cell.Coordinate.X}-{cell.Coordinate.Y}",
                    state.Environment.ToLngLat(xKm, yKm),
                    Math.Max(0.3, Math.Round(cell.Intensity, 3)),
                    index % 4 == 0 ? "ember" : "flame");
            })
            .ToList();
    }

    private static FireStats BuildStats(FireSimulationState state)
    {
        List<FireCell> affected = state.Cells.Values
            .Where(cell => cell.State is FireCellState.Active or FireCellState.Embers or FireCellState.Burned)
            .ToList();
        List<FireCell> active = state.Cells.Values
            .Where(cell => cell.State == FireCellState.Active)
            .ToList();
        double cellHectares = state.Environment.CellKm * state.Environment.CellKm * 100;
        var fuelImpacts = Enum.GetValues<FuelType>().ToDictionary(ToWireName, _ => 0);
        foreach (FireCell cell in affected)
        {
            fuelImpacts[ToWireName(cell.Fuel)]++;
        }

        double averageIntensity = active.Count == 0 ? 0 : active.Average(cell => cell.Intensity);
        return new FireStats(
            (int)Math.Round(affected.Count * cellHectares),
            Math.Round(active.Count * state.Environment.CellKm * 0.32, 1),
            averageIntensity > 0.78 ? "Extreme" : averageIntensity > 0.54 ? "Forte" : "Moderee",
            active.Count,
            CountThreatenedBuildings(state),
            fuelImpacts);
    }

    private static int CountThreatenedBuildings(FireSimulationState state)
    {
        int count = 0;
        foreach (FireCell cell in state.Cells.Values)
        {
            if (cell.Fuel != FuelType.Urban)
            {
                continue;
            }

            if (cell.State != FireCellState.Unburned)
            {
                count++;
                continue;
            }

            if (EightNeighborsWithin(cell.Coordinate, 2).Any(coordinate =>
                state.Cells.TryGetValue(coordinate, out FireCell? neighbor)
                && neighbor.State is FireCellState.Active or FireCellState.Embers or FireCellState.Burned or FireCellState.Heat))
            {
                count++;
            }
        }

        return count;
    }

    private static FuelType DominantFuel(IReadOnlyList<FireCell> cells)
        => cells.GroupBy(cell => cell.Fuel).OrderByDescending(group => group.Count()).First().Key;

    private static IEnumerable<FireGridCoordinate> FourNeighbors(FireGridCoordinate coordinate)
    {
        yield return new FireGridCoordinate(coordinate.X + 1, coordinate.Y);
        yield return new FireGridCoordinate(coordinate.X - 1, coordinate.Y);
        yield return new FireGridCoordinate(coordinate.X, coordinate.Y + 1);
        yield return new FireGridCoordinate(coordinate.X, coordinate.Y - 1);
    }

    private static IEnumerable<FireGridCoordinate> EightNeighborsWithin(FireGridCoordinate coordinate, int radius)
    {
        for (int y = -radius; y <= radius; y++)
        {
            for (int x = -radius; x <= radius; x++)
            {
                if (x != 0 || y != 0)
                {
                    yield return new FireGridCoordinate(coordinate.X + x, coordinate.Y + y);
                }
            }
        }
    }

    private static string ToWireName(FireCellState state) => state switch
    {
        FireCellState.Unburned => "unburned",
        FireCellState.Heat => "heat",
        FireCellState.Active => "active",
        FireCellState.Embers => "embers",
        FireCellState.Burned => "burned",
        _ => throw new ArgumentOutOfRangeException(nameof(state), state, null)
    };

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
