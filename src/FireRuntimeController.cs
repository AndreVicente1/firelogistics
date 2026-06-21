using FireLogistics.Core.World.Fire;
using System;
using System.Collections.Generic;

public sealed class FireRuntimeController
{
    private const double DefaultLongitude = 5.38;
    private const double DefaultLatitude = 43.3;
    private FireSimulationState _state = FireSimulator.Create(DefaultLongitude, DefaultLatitude);
    private IReadOnlyDictionary<FireGridCoordinate, FuelType>? _fuelOverrides;
    private double _tickTimer;

    public bool Running { get; private set; } = true;

    public FireSimulationFrame CurrentFrame => FireFrameBuilder.Build(_state);

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

        return true;
    }

    public void Pause() => Running = false;

    public void Resume()
    {
        if (_state.IsAlive)
        {
            Running = true;
        }
    }

    public void Reset()
    {
        _state = FireSimulator.Create(_state.Environment.Longitude, _state.Environment.Latitude, fuelOverrides: _fuelOverrides);
        _tickTimer = 0;
        Running = _state.IsAlive;
    }

    public void SetIgnitionCenter(double longitude, double latitude)
    {
        _fuelOverrides = null;
        _state = FireSimulator.Create(longitude, latitude);
        _tickTimer = 0;
        Running = _state.IsAlive;
    }

    public void SetFuelOverrides(IReadOnlyDictionary<FireGridCoordinate, FuelType>? fuelOverrides)
    {
        _fuelOverrides = fuelOverrides;
        int currentStep = _state.Step;
        _state = FireSimulator.Create(_state.Environment.Longitude, _state.Environment.Latitude, _state.Environment.IncidentSeed, _fuelOverrides);
        if (currentStep > 0)
        {
            FireSimulator.Advance(_state, currentStep);
        }

        Running = _state.IsAlive;
    }
}
