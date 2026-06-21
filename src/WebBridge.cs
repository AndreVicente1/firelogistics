using FireLogistics.Core.Bridge;
using FireLogistics.Core.Infrastructure;
using FireLogistics.Core.World.Fire;
using Godot;
using System;
using System.Collections.Generic;
using System.Text.Json;

public partial class WebBridge : Node
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly FireRuntimeController _fireRuntime = new();
    private Control? _webView;

    public void AttachWebView(Control webView)
    {
        _webView = webView;
    }

    public void OnWebViewPageLoadFinished(string url)
    {
        GD.Print("WebView page chargee: " + url);
        PushRuntimeMetricsToWeb();
        PushFireFrameToWeb();
        PushFuelSampleRequestToWeb();
    }

    public void OnWebViewMessage(string message)
    {
        if (!WebIpcMessage.TryParse(message, out WebIpcMessage? ipcMessage) || ipcMessage == null)
        {
            GD.PrintErr("[JS -> C#] Message invalide: " + message);
            return;
        }

        if (ipcMessage.Action == "diagnostics_log")
        {
            GD.Print("[Web diagnostics] " + ipcMessage.PayloadAsString());
        }
        else if (ipcMessage.Action == "fire_command")
        {
            HandleFireCommand(ipcMessage.Payload);
            PushFireFrameToWeb();
            PushFuelSampleRequestToWeb();
        }
        else if (ipcMessage.Action == "fire_ignition_selected")
        {
            GD.Print("[Web ignition] " + message);
            HandleFireIgnitionSelected(ipcMessage.Payload);
            PushFireFrameToWeb();
            PushFuelSampleRequestToWeb();
        }
        else if (ipcMessage.Action == "fire_fuel_overrides_ready")
        {
            if (HandleFuelOverrides(ipcMessage.Payload))
            {
                PushFireFrameToWeb();
            }
            PushFuelSampleRequestToWeb();
        }
        else if (ipcMessage.Action == "quit_game")
        {
            GetTree().Quit();
        }
    }

    public void ProcessFire(double delta)
    {
        if (_fireRuntime.Advance(delta))
        {
            PushFireFrameToWeb();
            PushFuelSampleRequestToWeb();
        }
    }

    public void PushRuntimeMetricsToWeb()
    {
        if (_webView == null)
        {
            return;
        }

        int fps = (int)Engine.GetFramesPerSecond();
        long ramBytes = ProcessTreeMemory.GetCurrentProcessWorkingSetBytes();
        string payload = JsonSerializer.Serialize(new { fps, ramBytes });
        _webView.Call("eval", $"if(window.FireLogistics?.updateRuntimeMetrics) window.FireLogistics.updateRuntimeMetrics({payload});");
    }

    public void PushFireFrameToWeb()
    {
        if (_webView == null)
        {
            return;
        }

        string payload = JsonSerializer.Serialize(_fireRuntime.CurrentFrame, JsonOptions);
        _webView.Call("eval", $"if(window.FireLogistics?.receiveFireFrame) window.FireLogistics.receiveFireFrame({payload});");
    }

    public void PushFuelSampleRequestToWeb()
    {
        if (_webView == null)
        {
            return;
        }

        FireFuelSampleRequest? request = _fireRuntime.TakeFuelSampleRequest();
        if (request == null)
        {
            return;
        }

        string payload = JsonSerializer.Serialize(request, JsonOptions);
        _webView.Call("eval", $"if(window.FireLogistics?.requestFuelSample) window.FireLogistics.requestFuelSample({payload});");
    }

    private void HandleFireCommand(JsonElement? payload)
    {
        string? command = TryReadString(payload, "command");
        if (string.Equals(command, "pause", StringComparison.OrdinalIgnoreCase))
        {
            _fireRuntime.Pause();
        }
        else if (string.Equals(command, "resume", StringComparison.OrdinalIgnoreCase))
        {
            _fireRuntime.Resume();
        }
        else if (string.Equals(command, "reset", StringComparison.OrdinalIgnoreCase))
        {
            _fireRuntime.Reset();
        }
        else if (string.Equals(command, "clear", StringComparison.OrdinalIgnoreCase))
        {
            _fireRuntime.Clear();
        }
    }

    private void HandleFireIgnitionSelected(JsonElement? payload)
    {
        if (payload is not { ValueKind: JsonValueKind.Object } element
            || !element.TryGetProperty("center", out JsonElement center)
            || center.ValueKind != JsonValueKind.Array
            || center.GetArrayLength() < 2)
        {
            return;
        }

        double longitude = center[0].GetDouble();
        double latitude = center[1].GetDouble();
        if (double.IsFinite(longitude) && double.IsFinite(latitude))
        {
            _fireRuntime.SetIgnitionCenter(longitude, latitude);
        }
    }

    private bool HandleFuelOverrides(JsonElement? payload)
    {
        if (payload is not { ValueKind: JsonValueKind.Object } element
            || !element.TryGetProperty("fuels", out JsonElement fuels)
            || fuels.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        int originX = TryReadInt(element, "originX") ?? -(TryReadInt(element, "width") ?? 0) / 2;
        int originY = TryReadInt(element, "originY") ?? -(TryReadInt(element, "height") ?? 0) / 2;
        int width = TryReadInt(element, "width") ?? 0;
        int height = TryReadInt(element, "height") ?? 0;
        if (width <= 0 || height <= 0 || fuels.GetArrayLength() < width * height)
        {
            return false;
        }

        var overrides = new Dictionary<FireGridCoordinate, FuelType>();
        int index = 0;
        foreach (JsonElement fuelElement in fuels.EnumerateArray())
        {
            int x = index % width;
            int y = index / width;
            index++;
            if (fuelElement.ValueKind == JsonValueKind.String
                && TryParseFuel(fuelElement.GetString(), out FuelType fuel))
            {
                overrides[new FireGridCoordinate(originX + x, originY + y)] = fuel;
            }
        }

        return _fireRuntime.MergeFuelOverrides(originX, originY, width, height, overrides);
    }

    private static string? TryReadString(JsonElement? payload, string propertyName)
    {
        return payload is { ValueKind: JsonValueKind.Object } element
            && element.TryGetProperty(propertyName, out JsonElement value)
            && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }

    private static int? TryReadInt(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out JsonElement value) && value.TryGetInt32(out int parsed)
            ? parsed
            : null;
    }

    private static bool TryParseFuel(string? value, out FuelType fuel)
    {
        fuel = FuelType.Water;
        return value switch
        {
            "water" => Assign(FuelType.Water, out fuel),
            "mineral" => Assign(FuelType.Mineral, out fuel),
            "crops" => Assign(FuelType.Crops, out fuel),
            "grass" => Assign(FuelType.Grass, out fuel),
            "scrub" => Assign(FuelType.Scrub, out fuel),
            "forest" => Assign(FuelType.Forest, out fuel),
            "urban" => Assign(FuelType.Urban, out fuel),
            _ => false
        };
    }

    private static bool Assign(FuelType value, out FuelType fuel)
    {
        fuel = value;
        return true;
    }
}
