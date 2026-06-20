namespace FireLogistics.Core.Infrastructure;

public static class ExportedRuntimePaths
{
    public const string WebRelativePath = "assets/web";
    public const string RoadGraphRelativePath = "assets/web/data/france-road-graph.bin";

    public static string? TryResolveBundledWebRoot(string? executableDirectory = null)
    {
        string baseDir = executableDirectory ?? AppContext.BaseDirectory;
        string webRoot = Path.Combine(baseDir, WebRelativePath);
        return Directory.Exists(webRoot) ? Path.GetFullPath(webRoot) : null;
    }

    public static string? TryResolveBundledRoadGraphPath(string? executableDirectory = null)
    {
        string baseDir = executableDirectory ?? AppContext.BaseDirectory;
        string graphPath = Path.Combine(baseDir, RoadGraphRelativePath);
        return File.Exists(graphPath) ? Path.GetFullPath(graphPath) : null;
    }
}
