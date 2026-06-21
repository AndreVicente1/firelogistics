namespace FireLogistics.Core.World.Fire;

public sealed record WireFireCell(
    int X,
    int Y,
    string Fuel,
    string State,
    double Intensity,
    double Heat);
