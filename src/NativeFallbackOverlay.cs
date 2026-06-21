using Godot;

public static class NativeFallbackOverlay
{
    public static void Create(Node owner)
    {
        var canvas = new CanvasLayer { Name = "NativeFallbackLayer" };
        owner.AddChild(canvas);

        var panel = new PanelContainer
        {
            AnchorLeft = 0,
            AnchorTop = 0,
            AnchorRight = 0,
            AnchorBottom = 0,
            OffsetLeft = 16,
            OffsetTop = 16,
            OffsetRight = 420,
            OffsetBottom = 160
        };
        canvas.AddChild(panel);

        var box = new VBoxContainer();
        panel.AddChild(box);
        box.AddChild(new Label { Text = "FIRE LOGISTICS", HorizontalAlignment = HorizontalAlignment.Center });
        box.AddChild(new Label
        {
            Text = "Carte WebView indisponible. La scene 3D native est chargee.",
            AutowrapMode = TextServer.AutowrapMode.WordSmart
        });
    }
}
