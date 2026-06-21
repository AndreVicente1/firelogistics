namespace FireLogistics.Core.World.Fire;

public sealed record FireSimulationFrame(
    int Step,
    double[] Center,
    int IncidentSeed,
    FireFeatureCollection Zones,
    IReadOnlyList<FireEmitter> Emitters,
    FireStats Stats,
    FireWind Wind,
    string Status);

public sealed record FireFeatureCollection(string Type, IReadOnlyList<FireFeature> Features);

public sealed record FireFeature(
    string Type,
    FireFeatureProperties Properties,
    FireGeometry Geometry);

public sealed record FireFeatureProperties(
    string Id,
    string State,
    string Fuel,
    double Intensity,
    int CellCount);

public sealed record FireGeometry(string Type, IReadOnlyList<IReadOnlyList<double[]>> Coordinates);

public sealed record FireEmitter(string Id, double[] LngLat, double Intensity, string Type);

public sealed record FireStats(
    int BurnedHectares,
    double FrontKilometers,
    string Intensity,
    int ActiveCells,
    int ThreatenedBuildings,
    IReadOnlyDictionary<string, int> FuelImpacts);

public sealed record FireWind(string Direction, int Degrees, int SpeedKmh);
