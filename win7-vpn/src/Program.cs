using System;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

namespace SaharVPN
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            using (var mutex = new Mutex(true, "SaharVPN-single-instance", out bool first))
            {
                if (!first)
                {
                    MessageBox.Show("SaharVPN уже запущен — посмотрите на значок возле часов.", "SaharVPN",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.ThreadException += (s, e) => ShowError(e.Exception);
                AppDomain.CurrentDomain.UnhandledException += (s, e) => ShowError(e.ExceptionObject as Exception);

                bool autostart = args.Any(a => a.Equals("--autostart", StringComparison.OrdinalIgnoreCase));
                Application.Run(new MainForm(autostart));
            }
        }

        static void ShowError(Exception ex)
        {
            MessageBox.Show("Непредвиденная ошибка:\n\n" + ex, "SaharVPN", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
