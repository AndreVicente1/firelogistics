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

    public static FireSimulationFrame Build(FireSimulationState state)
    {
        return new FireSimulationFrame(
            state.Step,
            [state.Environment.Longitude, state.Environment.Latitude],
            state.Environment.IncidentSeed,
            BuildFeatureCollection(state),
            BuildEmitters(state),
            BuildStats(state),
            new FireWind(
                state.Environment.WindDirection,
                72,
                (int)Math.Round(state.Environment.BaseWindSpeedKmh + Math.Sin(state.Step * 0.18) * 5)),
            state.IsAlive ? "running" : "extinguished");
    }

    private static FireFeatureCollection BuildFeatureCollection(FireSimulationState state)
    {
        var features = new List<FireFeature>();
        foreach (FireCellState renderState in RenderStates)
        {
            List<FireCell> cells = state.Cells.Values
                .Where(cell => cell.State == renderState)
                .ToList();

            foreach (List<FireCell> component in ConnectedComponents(cells))
            {
                IReadOnlyList<double[]> ring = BuildExteriorRing(state.Environment, component);
                if (ring.Count < 4)
                {
                    continue;
                }

                string stateName = ToWireName(renderState);
                features.Add(new FireFeature(
                    "Feature",
                    new FireFeatureProperties(
                        $"{stateName}-{features.Count}",
                        stateName,
                        ToWireName(DominantFuel(component)),
                        Math.Round(component.Max(cell => Math.Max(cell.Intensity, cell.Heat)), 3),
                        component.Count),
                    new FireGeometry("Polygon", [ring])));
            }
        }

        return new FireFeatureCollection("FeatureCollection", features);
    }

    private static IReadOnlyList<double[]> BuildExteriorRing(FireEnvironment environment, List<FireCell> cells)
    {
        HashSet<FireGridCoordinate> component = cells.Select(cell => cell.Coordinate).ToHashSet();
        var edges = new List<(Vertex Start, Vertex End)>();
        foreach (FireGridCoordinate c in component)
        {
            var north = new FireGridCoordinate(c.X, c.Y + 1);
            var east = new FireGridCoordinate(c.X + 1, c.Y);
            var south = new FireGridCoordinate(c.X, c.Y - 1);
            var west = new FireGridCoordinate(c.X - 1, c.Y);

            if (!component.Contains(north))
            {
                edges.Add((new Vertex(c.X, c.Y + 1), new Vertex(c.X + 1, c.Y + 1)));
            }

            if (!component.Contains(east))
            {
                edges.Add((new Vertex(c.X + 1, c.Y + 1), new Vertex(c.X + 1, c.Y)));
            }

            if (!component.Contains(south))
            {
                edges.Add((new Vertex(c.X + 1, c.Y), new Vertex(c.X, c.Y)));
            }

            if (!component.Contains(west))
            {
                edges.Add((new Vertex(c.X, c.Y), new Vertex(c.X, c.Y + 1)));
            }
        }

        List<List<Vertex>> loops = TraceLoops(edges);
        List<Vertex>? exterior = loops
            .OrderByDescending(loop => Math.Abs(SignedArea(loop)))
            .FirstOrDefault();
        if (exterior == null)
        {
            return [];
        }

        var coordinates = exterior.Select(vertex =>
        {
            double xKm = (vertex.X - 0.5) * environment.CellKm;
            double yKm = (vertex.Y - 0.5) * environment.CellKm;
            return environment.ToLngLat(xKm, yKm);
        }).ToList();

        if (coordinates.Count > 0 && !SameCoordinate(coordinates[0], coordinates[^1]))
        {
            coordinates.Add(coordinates[0]);
        }

        return coordinates;
    }

    private static List<List<Vertex>> TraceLoops(List<(Vertex Start, Vertex End)> edges)
    {
        var outgoing = edges
            .GroupBy(edge => edge.Start)
            .ToDictionary(group => group.Key, group => group.Select(edge => edge.End).ToList());
        var remaining = new HashSet<(Vertex Start, Vertex End)>(edges);
        var loops = new List<List<Vertex>>();

        while (remaining.Count > 0)
        {
            (Vertex start, Vertex end) = remaining.First();
            remaining.Remove((start, end));
            var loop = new List<Vertex> { start, end };
            Vertex current = end;

            while (current != start && outgoing.TryGetValue(current, out List<Vertex>? candidates))
            {
                Vertex? next = candidates.FirstOrDefault(candidate => remaining.Contains((current, candidate)));
                if (next == null)
                {
                    break;
                }

                remaining.Remove((current, next.Value));
                current = next.Value;
                loop.Add(current);
            }

            if (loop.Count >= 4 && loop[0] == loop[^1])
            {
                loops.Add(loop);
            }
        }

        return loops;
    }

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

    private static double SignedArea(IReadOnlyList<Vertex> loop)
    {
        double area = 0;
        for (int i = 0; i < loop.Count - 1; i++)
        {
            area += loop[i].X * loop[i + 1].Y - loop[i + 1].X * loop[i].Y;
        }

        return area * 0.5;
    }

    private static bool SameCoordinate(double[] left, double[] right)
        => Math.Abs(left[0] - right[0]) < 0.000000001 && Math.Abs(left[1] - right[1]) < 0.000000001;

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

    private readonly record struct Vertex(int X, int Y);
}
