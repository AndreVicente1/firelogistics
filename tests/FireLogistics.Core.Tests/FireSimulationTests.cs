using FireLogistics.Core.World.Fire;
using Xunit;

namespace FireLogistics.Core.Tests;

public sealed class FireSimulationTests
{
    [Fact]
    public void FireSimulationIsDeterministicForFixedSeed()
    {
        FireSimulationState left = FireSimulator.Create(5.38, 43.3, incidentSeed: 1234);
        FireSimulationState right = FireSimulator.Create(5.38, 43.3, incidentSeed: 1234);

        FireSimulator.Advance(left, 35);
        FireSimulator.Advance(right, 35);

        Assert.Equal(Snapshot(left), Snapshot(right));
        FireStats leftStats = FireFrameBuilder.Build(left).Stats;
        FireStats rightStats = FireFrameBuilder.Build(right).Stats;
        Assert.Equal(leftStats.BurnedHectares, rightStats.BurnedHectares);
        Assert.Equal(leftStats.FrontKilometers, rightStats.FrontKilometers);
        Assert.Equal(leftStats.Intensity, rightStats.Intensity);
        Assert.Equal(leftStats.ActiveCells, rightStats.ActiveCells);
        Assert.Equal(leftStats.ThreatenedBuildings, rightStats.ThreatenedBuildings);
        Assert.Equal(leftStats.FuelImpacts, rightStats.FuelImpacts);
    }

    [Fact]
    public void DifferentSeedsCreateDifferentFronts()
    {
        FireSimulationState left = FireSimulator.Create(5.38, 43.3, incidentSeed: 100);
        FireSimulationState right = FireSimulator.Create(5.38, 43.3, incidentSeed: 200);

        FireSimulator.Advance(left, 45);
        FireSimulator.Advance(right, 45);

        Assert.NotEqual(Snapshot(left), Snapshot(right));
    }

    [Fact]
    public void FireCanGrowPastTheFormerFixedGridBounds()
    {
        FireSimulationState state = FireSimulator.Create(5.38, 43.3, incidentSeed: 42);

        FireSimulator.Advance(state, 220);

        Assert.Contains(state.Cells.Values, cell =>
            cell.State is FireCellState.Active or FireCellState.Embers or FireCellState.Burned
            && (Math.Abs(cell.Coordinate.X) > 32 || Math.Abs(cell.Coordinate.Y) > 24));
    }

    [Fact]
    public void NonBurnableTerrainExtinguishesNaturally()
    {
        Dictionary<FireGridCoordinate, FuelType> overrides = Enumerable.Range(-4, 9)
            .SelectMany(y => Enumerable.Range(-4, 9), (y, x) => new FireGridCoordinate(x, y))
            .ToDictionary(coordinate => coordinate, _ => FuelType.Water);
        FireSimulationState state = FireSimulator.Create(5.38, 43.3, incidentSeed: 7, fuelOverrides: overrides);

        FireSimulator.Advance(state, 5);

        Assert.False(state.IsAlive);
        Assert.DoesNotContain(state.Cells.Values, cell => cell.State == FireCellState.Active);
    }

    [Fact]
    public void WaterAndMineralNeverBurn()
    {
        Dictionary<FireGridCoordinate, FuelType> overrides = Enumerable.Range(-8, 17)
            .SelectMany(y => Enumerable.Range(-8, 17), (y, x) => new FireGridCoordinate(x, y))
            .ToDictionary(
                coordinate => coordinate,
                coordinate => coordinate.X <= 0 ? FuelType.Water : FuelType.Mineral);
        FireSimulationState state = FireSimulator.Create(5.38, 43.3, incidentSeed: 12, fuelOverrides: overrides);

        FireSimulator.Advance(state, 20);

        Assert.All(state.Cells.Values.Where(cell => cell.Fuel is FuelType.Water or FuelType.Mineral), cell =>
            Assert.True(cell.State is FireCellState.Unburned or FireCellState.Burned));
        Assert.DoesNotContain(state.Cells.Values.Where(cell => cell.Fuel is FuelType.Water or FuelType.Mineral), cell =>
            cell.State is FireCellState.Active or FireCellState.Heat or FireCellState.Embers);
    }

    [Fact]
    public void FireFramePolygonsDoNotUseInnerRings()
    {
        FireSimulationState state = FireSimulator.Create(5.38, 43.3, incidentSeed: 42);
        FireSimulator.Advance(state, 60);

        FireSimulationFrame frame = FireFrameBuilder.Build(state);

        Assert.NotEmpty(frame.Zones.Features);
        Assert.All(frame.Zones.Features, feature => Assert.Single(feature.Geometry.Coordinates));
    }

    private static string Snapshot(FireSimulationState state)
    {
        return string.Join(
            "|",
            state.Cells.Values
                .Where(cell => cell.State != FireCellState.Unburned)
                .OrderBy(cell => cell.Coordinate.X)
                .ThenBy(cell => cell.Coordinate.Y)
                .Select(cell => $"{cell.Coordinate.X},{cell.Coordinate.Y}:{cell.State}:{Math.Round(cell.Heat, 3)}:{Math.Round(cell.FuelLoad, 3)}"));
    }
}
