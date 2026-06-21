namespace FireLogistics.Core.World.Fire;

public sealed record FireSimulationFrame(
    int Step,
    int Revision,
    string Reason,
    double[] Center,
    int IncidentSeed,
    FireFeatureCollection Zones,
    IReadOnlyList<WireFireCell> Cells,
    IReadOnlyList<FireEmitter> Emitters,
    FireStats Stats,
    FireWind Wind,
    string Status,
    FireBurnScarPatch? BurnScar = null);

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

public sealed record FireGeometry(string Type, object Coordinates);

public sealed record FireEmitter(string Id, double[] LngLat, double Intensity, string Type);

public sealed record FireStats(
    int BurnedHectares,
    double FrontKilometers,
    string Intensity,
    int ActiveCells,
    int ThreatenedBuildings,
    IReadOnlyDictionary<string, int> FuelImpacts);

public sealed record FireWind(string Direction, int Degrees, int SpeedKmh);

public sealed record FireFuelSampleRequest(int OriginX, int OriginY, int Width, int Height, double CellKm);

public sealed record FireBurnScarPatch(
    bool Reset,
    int Revision,
    double CellKm,
    IReadOnlyList<FireBurnScarRun> Runs);

public sealed record FireBurnScarRun(int Y, int X1, int X2, string Fuel);
