using System;
using System.Diagnostics;
using System.IO;

namespace SaharVPN
{
    /// <summary>Starts and stops xray.exe and forwards its log output.</summary>
    sealed class XrayRunner
    {
        Process proc;
        bool stopping;

        public event Action<string> Log;
        /// <summary>Raised when xray exits on its own (crash, bad config).</summary>
        public event Action<int> UnexpectedExit;

        public bool IsRunning
        {
            get
            {
                try { return proc != null && !proc.HasExited; } catch { return false; }
            }
        }

        public void Start(string exe, string configFile)
        {
            Stop();
            stopping = false;

            var psi = new ProcessStartInfo(exe, "run -c \"" + configFile + "\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = Path.GetDirectoryName(exe),
            };
            psi.EnvironmentVariables["XRAY_LOCATION_ASSET"] = Path.GetDirectoryName(exe);

            proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            proc.OutputDataReceived += (s, e) => { if (e.Data != null) Log?.Invoke(e.Data); };
            proc.ErrorDataReceived += (s, e) => { if (e.Data != null) Log?.Invoke(e.Data); };
            var started = proc;
            proc.Exited += (s, e) =>
            {
                if (stopping) return;
                int code = 0;
                try { code = started.ExitCode; } catch { }
                UnexpectedExit?.Invoke(code);
            };
            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
        }

        public void Stop()
        {
            stopping = true;
            var p = proc;
            proc = null;
            if (p == null) return;
            try
            {
                if (!p.HasExited)
                {
                    p.Kill();
                    p.WaitForExit(3000);
                }
            }
            catch { }
            finally { p.Dispose(); }
        }

        /// <summary>Kills xray.exe instances left over from a previous crash of this program (they would hold the ports).</summary>
        public static void KillOrphans(string exe)
        {
            string full = Path.GetFullPath(exe);
            foreach (var p in Process.GetProcessesByName("xray"))
            {
                try
                {
                    if (string.Equals(p.MainModule.FileName, full, StringComparison.OrdinalIgnoreCase))
                    {
                        p.Kill();
                        p.WaitForExit(2000);
                    }
                }
                catch { }
                finally { p.Dispose(); }
            }
        }
    }
}
