namespace FireLogistics.Core.World.Fire;

public static class FireSimulator
{
    public static FireSimulationState Create(double longitude, double latitude, int? incidentSeed = null, IReadOnlyDictionary<FireGridCoordinate, FuelType>? fuelOverrides = null)
    {
        int seed = incidentSeed ?? Random.Shared.Next(1, int.MaxValue);
        return new FireSimulationState(new FireEnvironment(longitude, latitude, seed, fuelOverrides));
    }

    public static void Advance(FireSimulationState state, int ticks = 1)
    {
        int count = Math.Max(1, ticks);
        for (int i = 0; i < count; i++)
        {
            AdvanceOneTick(state);
        }
    }

    private static void AdvanceOneTick(FireSimulationState state)
    {
        if (!state.IsAlive)
        {
            state.Step++;
            return;
        }

        Dictionary<FireGridCoordinate, FireCell> next = state.Cells.ToDictionary(pair => pair.Key, pair => pair.Value.Clone());
        foreach (FireCell source in state.Cells.Values.ToArray())
        {
            if (!FuelBehavior.For(source.Fuel).Burnable)
            {
                source.ApplyFuel(source.Fuel);
                continue;
            }

            if (source.State is not (FireCellState.Active or FireCellState.Embers))
            {
                continue;
            }

            int radius = source.State == FireCellState.Active ? 2 : 1;
            for (int dy = -radius; dy <= radius; dy++)
            {
                for (int dx = -radius; dx <= radius; dx++)
                {
                    if (dx == 0 && dy == 0)
                    {
                        continue;
                    }

                    var targetCoordinate = new FireGridCoordinate(source.Coordinate.X + dx, source.Coordinate.Y + dy);
                    FireCell target = state.GetOrCreate(targetCoordinate);
                    if (!next.TryGetValue(targetCoordinate, out FireCell? targetNext))
                    {
                        targetNext = target.Clone();
                        next.Add(targetCoordinate, targetNext);
                    }

                    if (!FuelBehavior.For(target.Fuel).Burnable)
                    {
                        targetNext.ApplyFuel(target.Fuel);
                        continue;
                    }

                    if (target.State is FireCellState.Burned or FireCellState.Active)
                    {
                        continue;
                    }

                    double addedHeat = HeatTransfer(state.Environment, source, target, dx, dy, state.Step + 1);
                    if (addedHeat <= 0)
                    {
                        continue;
                    }

                    targetNext.Heat = Clamp(targetNext.Heat + addedHeat, 0, 1.35);
                    if (targetNext.State == FireCellState.Unburned && targetNext.Heat > 0.22)
                    {
                        targetNext.State = FireCellState.Heat;
                    }
                }
            }
        }

        ApplySpotting(state, next);
        UpdateCombustionStates(next.Values);
        state.MutableCells.Clear();
        foreach ((FireGridCoordinate coordinate, FireCell cell) in next)
        {
            if (cell.State != FireCellState.Unburned || cell.Heat > 0.001 || FuelBehavior.For(cell.Fuel).Burnable)
            {
                state.MutableCells.Add(coordinate, cell);
            }
        }

        state.Step++;
    }

    private static double HeatTransfer(FireEnvironment environment, FireCell source, FireCell target, int dx, int dy, int tick)
    {
        FuelBehavior targetBehavior = FuelBehavior.For(target.Fuel);
        if (!targetBehavior.Burnable)
        {
            return 0;
        }

        double distance = Math.Sqrt(dx * dx + dy * dy);
        double alignment = WindAlignment(environment, dx, dy);
        double windFactor = Clamp(1 + alignment * 0.72, 0.24, 1.95);
        double distanceFactor = 1 / Math.Pow(Math.Max(1, distance), 1.35);
        double slopeFactor = Clamp(1 + (target.Coordinate.Y - source.Coordinate.Y) * environment.CellKm * 0.06, 0.88, 1.14);
        double noiseFactor = 0.84 + FireNoise.Value(target.Coordinate.X, target.Coordinate.Y, environment.IncidentSeed + tick) * 0.34;
        double fuelFactor = targetBehavior.Spread * (1 - targetBehavior.Moisture * 0.34);
        return SourceRadiantPower(source) * fuelFactor * windFactor * distanceFactor * slopeFactor * noiseFactor * 0.25;
    }

    private static void ApplySpotting(FireSimulationState state, Dictionary<FireGridCoordinate, FireCell> next)
    {
        foreach (FireCell source in state.Cells.Values.ToArray())
        {
            FuelBehavior behavior = FuelBehavior.For(source.Fuel);
            if (source.State != FireCellState.Active || behavior.Spotting <= 0)
            {
                continue;
            }

            int downwindX = (int)Math.Round(source.Coordinate.X + state.Environment.WindX * (2 + behavior.Spotting * 12));
            int downwindY = (int)Math.Round(source.Coordinate.Y + state.Environment.WindY * (1 + behavior.Spotting * 6));
            var coordinate = new FireGridCoordinate(downwindX, downwindY);
            FireCell candidate = state.GetOrCreate(coordinate);
            if (!next.TryGetValue(coordinate, out FireCell? candidateNext))
            {
                candidateNext = candidate.Clone();
                next.Add(coordinate, candidateNext);
            }

            FuelBehavior targetBehavior = FuelBehavior.For(candidate.Fuel);
            if (!targetBehavior.Burnable || candidate.State is FireCellState.Active or FireCellState.Burned)
            {
                continue;
            }

            double probability = behavior.Spotting * source.Intensity * (1 - targetBehavior.Moisture) * 0.55;
            if (FireNoise.Value(source.Coordinate.X + candidate.Coordinate.X, source.Coordinate.Y + candidate.Coordinate.Y, state.Environment.IncidentSeed + state.Step + 19) < probability)
            {
                candidateNext.Heat = Math.Max(candidateNext.Heat, IgnitionThreshold(candidate) + 0.04);
                candidateNext.State = FireCellState.Heat;
            }
        }
    }

    private static void UpdateCombustionStates(IEnumerable<FireCell> cells)
    {
        foreach (FireCell cell in cells)
        {
            FuelBehavior behavior = FuelBehavior.For(cell.Fuel);
            if (!behavior.Burnable)
            {
                cell.ApplyFuel(cell.Fuel);
                continue;
            }

            if (cell.State == FireCellState.Active)
            {
                cell.Age++;
                double consumption = (0.38 + cell.Intensity * 0.2) / Math.Max(1, behavior.BurnTicks);
                cell.FuelLoad = Clamp(cell.FuelLoad - consumption, 0, 1);
                cell.Heat = Clamp(cell.Heat + 0.1, 0, 1.2);
                double maturity = Clamp(cell.Age / (double)Math.Max(1, behavior.BurnTicks), 0, 1);
                cell.Intensity = behavior.Flame * Clamp(cell.FuelLoad * 1.22, 0.18, 1) * (1 - maturity * 0.22);
                if (cell.FuelLoad <= 0.1 || cell.Age >= behavior.BurnTicks * 1.45)
                {
                    cell.State = FireCellState.Embers;
                    cell.Age = 0;
                    cell.Heat = Math.Max(cell.Heat, 0.58);
                    cell.Intensity = behavior.Flame * 0.34;
                }
            }
            else if (cell.State == FireCellState.Embers)
            {
                cell.Age++;
                cell.Heat = Clamp(cell.Heat * (0.92 - behavior.Moisture * 0.05), 0, 1);
                cell.Intensity = behavior.Flame * Clamp(cell.Heat, 0.18, 0.48);
                if (cell.Age >= behavior.EmberTicks || cell.Heat < 0.18)
                {
                    cell.State = FireCellState.Burned;
                    cell.Heat = 0.08;
                    cell.Intensity = 0;
                }
            }
            else if (cell.State == FireCellState.Heat)
            {
                cell.Age++;
                cell.Heat = Clamp(cell.Heat * (0.95 - behavior.Moisture * 0.12), 0, 1.35);
                if (cell.Heat >= IgnitionThreshold(cell))
                {
                    cell.State = FireCellState.Active;
                    cell.Age = 0;
                    cell.Intensity = behavior.Flame * Clamp(cell.Heat, 0.55, 1.1);
                }
                else if (cell.Heat < 0.16 || cell.Age > 10)
                {
                    cell.State = FireCellState.Unburned;
                    cell.Age = 0;
                    cell.Heat = 0;
                }
            }
        }
    }

    private static double SourceRadiantPower(FireCell cell)
    {
        FuelBehavior behavior = FuelBehavior.For(cell.Fuel);
        if (cell.State == FireCellState.Active)
        {
            double loadFactor = Clamp(cell.FuelLoad * 1.35, 0.28, 1.15);
            return behavior.Flame * loadFactor * (0.86 + cell.Heat * 0.28);
        }

        return cell.State == FireCellState.Embers
            ? behavior.Flame * Clamp(cell.Heat, 0.2, 0.62) * 0.42
            : 0;
    }

    private static double IgnitionThreshold(FireCell cell)
    {
        FuelBehavior behavior = FuelBehavior.For(cell.Fuel);
        return behavior.Burnable
            ? behavior.Ignition + behavior.Moisture * 0.18 + behavior.Resistance * 0.12
            : double.PositiveInfinity;
    }

    private static double WindAlignment(FireEnvironment environment, int dx, int dy)
    {
        double distance = Math.Sqrt(dx * dx + dy * dy);
        return (dx * environment.WindX + dy * environment.WindY) / Math.Max(1, distance);
    }

    private static double Clamp(double value, double min, double max) => Math.Max(min, Math.Min(max, value));
}
