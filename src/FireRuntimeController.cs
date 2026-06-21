using FireLogistics.Core.World.Fire;
using System;
using System.Collections.Generic;
using System.Linq;

public sealed class FireRuntimeController
{
    private const double DefaultLongitude = 5.38;
    private const double DefaultLatitude = 43.3;
    private const int SampleWidth = 129;
    private const int SampleHeight = 97;
    private const int SampleMargin = 14;
    private FireSimulationState _state = FireSimulator.Create(DefaultLongitude, DefaultLatitude, igniteOnStart: false);
    private int? _sampleOriginX;
    private int? _sampleOriginY;
    private int? _sampleWidth;
    private int? _sampleHeight;
    private bool _sampleRequestPending;
    private bool _hasIgnition;
    private double _tickTimer;
    private int _revision = 1;
    private string _reason = "initial";

    public bool Running { get; private set; }

    public FireSimulationFrame CurrentFrame => FireFrameBuilder.Build(_state, CurrentStatus, _revision, _reason);

    private string CurrentStatus => !_hasIgnition
        ? "idle"
        : Running
            ? "running"
            : _state.IsAlive ? "paused" : "extinguished";

    public bool Advance(double deltaSeconds)
    {
        if (!Running)
        {
            return false;
        }

        _tickTimer += deltaSeconds;
        if (_tickTimer < 0.72)
        {
            return false;
        }

        _tickTimer = 0;
        FireSimulator.Advance(_state);
        if (!_state.IsAlive)
        {
            Running = false;
        }

        Publish("tick");
        return true;
    }

    public void Pause()
    {
        if (!Running)
        {
            return;
        }

        Running = false;
        Publish("command");
    }

    public void Resume()
    {
        if (_state.IsAlive && !Running)
        {
            Running = true;
            Publish("command");
        }
    }

    public void Reset()
    {
        if (!_hasIgnition)
        {
            return;
        }

        _state = FireSimulator.Create(_state.Environment.Longitude, _state.Environment.Latitude);
        _tickTimer = 0;
        ClearSampleState();
        Running = _state.IsAlive;
        ResetRevision("reset");
    }

    public void Clear()
    {
        _state = FireSimulator.Create(
            _state.Environment.Longitude,
            _state.Environment.Latitude,
            igniteOnStart: false);
        _tickTimer = 0;
        _hasIgnition = false;
        ClearSampleState();
        Running = false;
        ResetRevision("clear");
    }

    public void SetIgnitionCenter(double longitude, double latitude)
    {
        _state = FireSimulator.Create(longitude, latitude);
        _tickTimer = 0;
        _hasIgnition = true;
        ClearSampleState();
        Running = _state.IsAlive;
        ResetRevision("ignition");
    }

    public bool MergeFuelOverrides(
        int originX,
        int originY,
        int width,
        int height,
        IReadOnlyDictionary<FireGridCoordinate, FuelType> fuelOverrides)
    {
        string before = BuildVisibleSignature();
        _sampleOriginX = originX;
        _sampleOriginY = originY;
        _sampleWidth = width;
        _sampleHeight = height;
        _sampleRequestPending = false;
        _state.ApplyFuelOverrides(fuelOverrides);
        Running = Running && _state.IsAlive;
        if (before == BuildVisibleSignature())
        {
            return false;
        }

        Publish("fuel_sample");
        return true;
    }

    public FireFuelSampleRequest? TakeFuelSampleRequest()
    {
        if (_sampleRequestPending)
        {
            return null;
        }

        FireFuelSampleRequest? request = NeedsFuelSample()
            ? BuildFuelSampleRequest()
            : null;
        if (request != null)
        {
            _sampleRequestPending = true;
        }

        return request;
    }

    private bool NeedsFuelSample()
    {
        if (!_hasIgnition || !_state.IsAlive)
        {
            return false;
        }

        if (!_sampleOriginX.HasValue || !_sampleOriginY.HasValue || !_sampleWidth.HasValue || !_sampleHeight.HasValue)
        {
            return true;
        }

        int minX = _sampleOriginX.Value + SampleMargin;
        int maxX = _sampleOriginX.Value + _sampleWidth.Value - SampleMargin;
        int minY = _sampleOriginY.Value + SampleMargin;
        int maxY = _sampleOriginY.Value + _sampleHeight.Value - SampleMargin;
        return _state.Cells.Values.Any(cell =>
            cell.State is FireCellState.Active or FireCellState.Heat or FireCellState.Embers
            && (cell.Coordinate.X <= minX
                || cell.Coordinate.X >= maxX
                || cell.Coordinate.Y <= minY
                || cell.Coordinate.Y >= maxY));
    }

    private FireFuelSampleRequest BuildFuelSampleRequest()
    {
        List<FireCell> liveCells = _state.Cells.Values
            .Where(cell => cell.State is FireCellState.Active or FireCellState.Heat or FireCellState.Embers)
            .ToList();
        int centerX = liveCells.Count == 0 ? 0 : (int)Math.Round(liveCells.Average(cell => cell.Coordinate.X));
        int centerY = liveCells.Count == 0 ? 0 : (int)Math.Round(liveCells.Average(cell => cell.Coordinate.Y));
        return new FireFuelSampleRequest(
            centerX - SampleWidth / 2,
            centerY - SampleHeight / 2,
            SampleWidth,
            SampleHeight,
            _state.Environment.CellKm);
    }

    private void ClearSampleState()
    {
        _sampleOriginX = null;
        _sampleOriginY = null;
        _sampleWidth = null;
        _sampleHeight = null;
        _sampleRequestPending = false;
    }

    private void Publish(string reason)
    {
        _revision++;
        _reason = reason;
    }

    private void ResetRevision(string reason)
    {
        _revision = 1;
        _reason = reason;
    }

    private string BuildVisibleSignature()
    {
        return string.Join(
            "|",
            _state.Cells.Values
                .Where(cell => cell.State != FireCellState.Unburned)
                .OrderBy(cell => cell.Coordinate.X)
                .ThenBy(cell => cell.Coordinate.Y)
                .Select(cell => $"{cell.Coordinate.X},{cell.Coordinate.Y}:{cell.State}:{cell.Fuel}:{Math.Round(cell.Heat, 2)}"));
    }
}
