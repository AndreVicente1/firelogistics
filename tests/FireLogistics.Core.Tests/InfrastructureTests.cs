using FireLogistics.Core.Infrastructure;
using Xunit;

namespace FireLogistics.Core.Tests;

public sealed class InfrastructureTests
{
    [Fact]
    public void ExportedRuntimePathsResolvesExistingBundledWebRoot()
    {
        string tempRoot = Path.Combine(Path.GetTempPath(), "FireLogistics_PathTest_" + Guid.NewGuid());
        string webRoot = Path.Combine(tempRoot, "assets", "web");
        Directory.CreateDirectory(webRoot);

        try
        {
            string? resolved = ExportedRuntimePaths.TryResolveBundledWebRoot(tempRoot);

            Assert.Equal(Path.GetFullPath(webRoot), resolved);
        }
        finally
        {
            Directory.Delete(tempRoot, recursive: true);
        }
    }

    [Fact]
    public void LocalWebServerRejectsPathTraversal()
    {
        string root = Path.Combine(Path.GetTempPath(), "FireLogistics_WebRoot_" + Guid.NewGuid());
        Directory.CreateDirectory(root);

        try
        {
            using var server = new LocalWebServer(root);
            Assert.StartsWith("http://127.0.0.1:", server.BaseUrl, StringComparison.Ordinal);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task LocalWebServerSupportsRangeRequestsForPmtiles()
    {
        string root = Path.Combine(Path.GetTempPath(), "FireLogistics_WebRoot_" + Guid.NewGuid());
        Directory.CreateDirectory(Path.Combine(root, "data"));
        string pmtilesPath = Path.Combine(root, "data", "france-openmaptiles.pmtiles");
        await File.WriteAllBytesAsync(pmtilesPath, Enumerable.Range(0, 64).Select(value => (byte)value).ToArray());

        try
        {
            using var server = new LocalWebServer(root);
            using var client = new HttpClient();
            using var request = new HttpRequestMessage(HttpMethod.Get, server.BaseUrl + "data/france-openmaptiles.pmtiles");
            request.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(10, 19);

            using HttpResponseMessage response = await client.SendAsync(request);
            byte[] payload = await response.Content.ReadAsByteArrayAsync();

            Assert.Equal(System.Net.HttpStatusCode.PartialContent, response.StatusCode);
            Assert.Equal("application/octet-stream", response.Content.Headers.ContentType?.MediaType);
            Assert.Equal(Enumerable.Range(10, 10).Select(value => (byte)value), payload);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
