using System.Text.Json;

namespace FireLogistics.Core.Bridge;

public sealed class WebIpcMessage
{
    private WebIpcMessage(string action, JsonElement? payload)
    {
        Action = action;
        Payload = payload;
    }

    public string Action { get; }

    public JsonElement? Payload { get; }

    public static bool TryParse(string message, out WebIpcMessage? parsed)
    {
        parsed = null;
        if (string.IsNullOrWhiteSpace(message))
        {
            return false;
        }

        try
        {
            using JsonDocument document = JsonDocument.Parse(message);
            if (document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty("action", out JsonElement actionElement)
                || actionElement.ValueKind != JsonValueKind.String)
            {
                return false;
            }

            string? action = actionElement.GetString();
            if (string.IsNullOrWhiteSpace(action))
            {
                return false;
            }

            JsonElement? payload = document.RootElement.TryGetProperty("payload", out JsonElement payloadElement)
                ? payloadElement.Clone()
                : null;
            parsed = new WebIpcMessage(action, payload);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public string PayloadAsString()
    {
        if (Payload is not { } payload)
        {
            return string.Empty;
        }

        return payload.ValueKind == JsonValueKind.String
            ? payload.GetString() ?? string.Empty
            : payload.GetRawText();
    }
}
