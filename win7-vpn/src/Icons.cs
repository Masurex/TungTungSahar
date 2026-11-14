using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace SaharVPN
{
    /// <summary>Draws the round tray/window icon in a given colour (grey = off, green = on, orange = connecting).</summary>
    static class Icons
    {
        public static readonly Color Off = Color.FromArgb(130, 130, 140);
        public static readonly Color On = Color.FromArgb(34, 170, 90);
        public static readonly Color Busy = Color.FromArgb(230, 150, 30);

        [DllImport("user32.dll")]
        static extern bool DestroyIcon(IntPtr handle);

        public static Icon Make(Color color, int size = 32)
        {
            using (var bmp = new Bitmap(size, size))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);
                    using (var b = new SolidBrush(color))
                        g.FillEllipse(b, 1, 1, size - 3, size - 3);

                    // white shield-like check mark
                    float s = size / 32f;
                    using (var pen = new Pen(Color.White, 3.2f * s) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
                        g.DrawLines(pen, new[] { new PointF(9 * s, 16.5f * s), new PointF(14 * s, 21.5f * s), new PointF(23 * s, 11 * s) });
                }
                IntPtr h = bmp.GetHicon();
                try
                {
                    using (var tmp = Icon.FromHandle(h))
                        return (Icon)tmp.Clone();
                }
                finally
                {
                    DestroyIcon(h);
                }
            }
        }
    }
}
