using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace FireLogistics.Core.Infrastructure;

public sealed class LocalWebServer : IDisposable
{
    private readonly string _rootPath;
    private readonly TcpListener _listener;
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _acceptLoop;

    public string BaseUrl { get; }

    public LocalWebServer(string rootPath)
    {
        _rootPath = Path.GetFullPath(rootPath);
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();

        int port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        BaseUrl = $"http://127.0.0.1:{port}/";
        _acceptLoop = Task.Run(AcceptLoopAsync);
    }

    public void Dispose()
    {
        _cts.Cancel();
        _listener.Stop();
        _cts.Dispose();
    }

    private async Task AcceptLoopAsync()
    {
        while (!_cts.IsCancellationRequested)
        {
            try
            {
                TcpClient client = await _listener.AcceptTcpClientAsync(_cts.Token);
                _ = Task.Run(() => HandleClientAsync(client, _cts.Token));
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch
            {
                if (_cts.IsCancellationRequested)
                {
                    break;
                }
            }
        }
    }

    private async Task HandleClientAsync(TcpClient client, CancellationToken cancellationToken)
    {
        await using NetworkStream stream = client.GetStream();
        using (client)
        {
            string request = await ReadRequestHeaderAsync(stream, cancellationToken);
            if (string.IsNullOrWhiteSpace(request))
            {
                return;
            }

            string[] lines = request.Split("\r\n", StringSplitOptions.None);
            string[] requestLine = lines[0].Split(' ', 3, StringSplitOptions.RemoveEmptyEntries);
            if (requestLine.Length < 2)
            {
                await SendPlainAsync(stream, 400, "Bad Request", "Bad request.", cancellationToken);
                return;
            }

            string method = requestLine[0].ToUpperInvariant();
            if (method != "GET" && method != "HEAD")
            {
                await SendPlainAsync(stream, 405, "Method Not Allowed", "Method not allowed.", cancellationToken);
                return;
            }

            Dictionary<string, string> headers = ParseHeaders(lines);
            string? filePath = ResolvePath(requestLine[1]);
            if (filePath == null || !File.Exists(filePath))
            {
                await SendPlainAsync(stream, 404, "Not Found", "Not found.", cancellationToken);
                return;
            }

            await SendFileAsync(stream, method, filePath, headers, cancellationToken);
        }
    }

    private static async Task<string> ReadRequestHeaderAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        byte[] buffer = new byte[8192];
        using var memory = new MemoryStream();

        while (memory.Length < 32768)
        {
            int read = await stream.ReadAsync(buffer, cancellationToken);
            if (read <= 0)
            {
                break;
            }

            memory.Write(buffer, 0, read);
            if (Encoding.ASCII.GetString(memory.GetBuffer(), 0, (int)memory.Length).Contains("\r\n\r\n", StringComparison.Ordinal))
            {
                break;
            }
        }

        return Encoding.ASCII.GetString(memory.ToArray());
    }

    private static Dictionary<string, string> ParseHeaders(string[] lines)
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 1; i < lines.Length; i++)
        {
            int separator = lines[i].IndexOf(':');
            if (separator <= 0)
            {
                continue;
            }

            string name = lines[i][..separator].Trim();
            string value = lines[i][(separator + 1)..].Trim();
            headers[name] = value;
        }

        return headers;
    }

    private string? ResolvePath(string rawTarget)
    {
        string target = rawTarget.Split('?', 2)[0];
        target = Uri.UnescapeDataString(target).Replace('/', Path.DirectorySeparatorChar);
        target = target.TrimStart(Path.DirectorySeparatorChar);
        if (string.IsNullOrWhiteSpace(target))
        {
            target = "index.html";
        }

        string fullPath = Path.GetFullPath(Path.Combine(_rootPath, target));
        string rootWithSeparator = _rootPath.EndsWith(Path.DirectorySeparatorChar)
            ? _rootPath
            : _rootPath + Path.DirectorySeparatorChar;

        if (!fullPath.Equals(_rootPath, StringComparison.OrdinalIgnoreCase)
            && !fullPath.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return fullPath;
    }

    private static async Task SendFileAsync(
        NetworkStream stream,
        string method,
        string filePath,
        Dictionary<string, string> headers,
        CancellationToken cancellationToken)
    {
        var fileInfo = new FileInfo(filePath);
        long fileLength = fileInfo.Length;
        long start = 0;
        long end = fileLength - 1;
        bool partial = TryParseRange(headers.GetValueOrDefault("Range"), fileLength, out start, out end);

        if (fileLength > 0 && (start < 0 || start >= fileLength || end < start))
        {
            await SendHeaderAsync(stream, 416, "Range Not Satisfiable", new Dictionary<string, string>
            {
                ["Content-Range"] = $"bytes */{fileLength}",
                ["Content-Length"] = "0",
                ["Accept-Ranges"] = "bytes"
            }, cancellationToken);
            return;
        }

        long contentLength = fileLength == 0 ? 0 : end - start + 1;
        var responseHeaders = new Dictionary<string, string>
        {
            ["Content-Type"] = GetContentType(filePath),
            ["Content-Length"] = contentLength.ToString(CultureInfo.InvariantCulture),
            ["Accept-Ranges"] = "bytes",
            ["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0",
            ["Pragma"] = "no-cache",
            ["Expires"] = "0",
            ["Connection"] = "close"
        };

        if (partial)
        {
            responseHeaders["Content-Range"] = $"bytes {start}-{end}/{fileLength}";
        }

        await SendHeaderAsync(
            stream,
            partial ? 206 : 200,
            partial ? "Partial Content" : "OK",
            responseHeaders,
            cancellationToken);

        if (method == "HEAD" || contentLength == 0)
        {
            return;
        }

        await using FileStream fileStream = File.OpenRead(filePath);
        fileStream.Seek(start, SeekOrigin.Begin);
        byte[] buffer = new byte[128 * 1024];
        long remaining = contentLength;

        while (remaining > 0)
        {
            int toRead = (int)Math.Min(buffer.Length, remaining);
            int read = await fileStream.ReadAsync(buffer.AsMemory(0, toRead), cancellationToken);
            if (read <= 0)
            {
                break;
            }

            await stream.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            remaining -= read;
        }
    }

    private static bool TryParseRange(string? rangeHeader, long fileLength, out long start, out long end)
    {
        start = 0;
        end = fileLength - 1;

        if (string.IsNullOrWhiteSpace(rangeHeader) || !rangeHeader.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        string range = rangeHeader["bytes=".Length..].Split(',', 2)[0].Trim();
        string[] parts = range.Split('-', 2);
        if (parts.Length != 2)
        {
            return false;
        }

        if (parts[0].Length == 0)
        {
            if (!long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out long suffixLength) || suffixLength <= 0)
            {
                return false;
            }

            start = Math.Max(0, fileLength - suffixLength);
            end = fileLength - 1;
            return true;
        }

        if (!long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out start))
        {
            return false;
        }

        if (parts[1].Length > 0 && long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out long parsedEnd))
        {
            end = Math.Min(parsedEnd, fileLength - 1);
        }
        else
        {
            end = fileLength - 1;
        }

        return true;
    }

    private static async Task SendPlainAsync(
        NetworkStream stream,
        int statusCode,
        string statusText,
        string body,
        CancellationToken cancellationToken)
    {
        byte[] bodyBytes = Encoding.UTF8.GetBytes(body);
        await SendHeaderAsync(stream, statusCode, statusText, new Dictionary<string, string>
        {
            ["Content-Type"] = "text/plain; charset=utf-8",
            ["Content-Length"] = bodyBytes.Length.ToString(CultureInfo.InvariantCulture),
            ["Connection"] = "close"
        }, cancellationToken);
        await stream.WriteAsync(bodyBytes, cancellationToken);
    }

    private static async Task SendHeaderAsync(
        NetworkStream stream,
        int statusCode,
        string statusText,
        Dictionary<string, string> headers,
        CancellationToken cancellationToken)
    {
        var builder = new StringBuilder();
        builder.Append(CultureInfo.InvariantCulture, $"HTTP/1.1 {statusCode} {statusText}\r\n");
        foreach ((string key, string value) in headers)
        {
            builder.Append(key).Append(": ").Append(value).Append("\r\n");
        }

        builder.Append("\r\n");
        byte[] bytes = Encoding.ASCII.GetBytes(builder.ToString());
        await stream.WriteAsync(bytes, cancellationToken);
    }

    private static string GetContentType(string filePath)
    {
        return Path.GetExtension(filePath).ToLowerInvariant() switch
        {
            ".html" => "text/html; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".js" => "application/javascript; charset=utf-8",
            ".json" => "application/json; charset=utf-8",
            ".geojson" => "application/geo+json; charset=utf-8",
            ".pmtiles" => "application/octet-stream",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".svg" => "image/svg+xml",
            ".ico" => "image/x-icon",
            ".webp" => "image/webp",
            _ => "application/octet-stream"
        };
    }
}
