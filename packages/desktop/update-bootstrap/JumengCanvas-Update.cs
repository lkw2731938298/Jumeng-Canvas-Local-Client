// 聚梦无限画布 · 应用内更新引导包
// 0.1.19 用「隐藏 PowerShell」Start-Process 本程序时，子进程 GUI 常被吞掉（用户只见画布退出、无任何窗口）。
// 因此：无 --ui 时先用 ShellExecute 再拉起自己（可见会话）并 Wait；有 --ui 后再走下载/安装。
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    const string FullSetupUrl =
        "https://jumeng-canvas.oss-cn-hangzhou.aliyuncs.com/releases/canvas/JumengCanvas-Setup.exe";
    const string SetupFileName = "JumengCanvas-Setup.exe";
    const string AppProcessName = "聚梦无限画布";
    const string ShortcutName = "聚梦无限画布.lnk";
    const long MinSetupBytes = 50L * 1024 * 1024;

    [STAThread]
    static int Main(string[] args)
    {
        string tmpDir = Path.Combine(Path.GetTempPath(), "jumeng-canvas-update");
        try { Directory.CreateDirectory(tmpDir); } catch { /* ignore */ }
        string logPath = Path.Combine(tmpDir, "update-bootstrap.log");

        // 最先写日志：即使后面崩了也能判断「引导包有没有被拉起」
        Log(logPath, "entry args=[" + string.Join("][", args ?? new string[0]) + "]");
        Log(logPath, "exe=" + SelfPath());

        bool hasUi = false;
        var passArgs = new StringBuilder();
        if (args != null)
        {
            foreach (var a in args)
            {
                if (string.Equals(a, "--ui", StringComparison.OrdinalIgnoreCase))
                {
                    hasUi = true;
                    continue;
                }
                if (passArgs.Length > 0) passArgs.Append(' ');
                // 简单转义：含空格则加引号
                if (a.IndexOf(' ') >= 0) passArgs.Append('"').Append(a).Append('"');
                else passArgs.Append(a);
            }
        }

        // 从隐藏 PowerShell 拉起时，必须脱离父会话再显示窗口
        if (!hasUi)
        {
            try
            {
                string self = SelfPath();
                string argLine = "--ui";
                if (passArgs.Length > 0) argLine += " " + passArgs;

                // 方式 1：explorer 打开（最容易出前台窗口）
                // explorer 不能可靠传参，故用 cmd start
                var psi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c start \"JumengUpdate\" /WAIT \"" + self + "\" " + argLine,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                };
                Log(logPath, "relaunch visible: " + psi.FileName + " " + psi.Arguments);
                using (var p = Process.Start(psi))
                {
                    if (p == null)
                    {
                        Log(logPath, "relaunch Process.Start returned null");
                        // 兜底：直接 ShellExecute 自己
                        return RelaunchShellExecute(self, argLine, logPath);
                    }
                    p.WaitForExit();
                    Log(logPath, "relaunch wrapper exit=" + p.ExitCode);
                    return p.ExitCode;
                }
            }
            catch (Exception ex)
            {
                Log(logPath, "relaunch fail: " + ex);
                try
                {
                    MessageBox.Show(
                        "无法打开更新助手：" + ex.Message + "\n\n日志：" + logPath,
                        "聚梦无限画布",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                }
                catch { /* ignore */ }
                return 1;
            }
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string setupPath = Path.Combine(tmpDir, SetupFileName);
        string downloadsCopy = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "Downloads",
            SetupFileName);

        ProgressForm ui = null;
        try
        {
            ui = new ProgressForm();
            ui.Show();
            ui.Activate();
            ui.BringToFront();
            ui.SetStatus("更新助手已打开。正在等待画布退出…");
            Application.DoEvents();
            Log(logPath, "ui shown");

            WaitAppExit(AppProcessName, 120, ui, logPath);
            Thread.Sleep(2000);

            ui.SetStatus("正在准备最新安装包…");
            Application.DoEvents();
            EnsureFreshSetup(FullSetupUrl, setupPath, ui, logPath);

            try
            {
                string dlDir = Path.GetDirectoryName(downloadsCopy);
                if (!string.IsNullOrEmpty(dlDir)) Directory.CreateDirectory(dlDir);
                File.Copy(setupPath, downloadsCopy, true);
                Log(logPath, "copied to " + downloadsCopy);
            }
            catch (Exception ex)
            {
                Log(logPath, "copy downloads skip: " + ex.Message);
            }

            ui.SetStatus("即将打开安装向导，请点「下一步 / 安装」直到完成。");
            ui.SetProgress(100);
            Application.DoEvents();
            Thread.Sleep(600);

            // 用 start 打开安装器，避免再被无窗会话影响
            int code = RunInstallerVisible(setupPath, logPath);
            Log(logPath, "installer exit=" + code);

            if (code != 0)
            {
                ui.Hide();
                var r = MessageBox.Show(
                    "安装向导未完成（退出码 " + code + "）。\n\n是否打开安装包手动安装？\n" + setupPath,
                    "聚梦无限画布 · 更新助手",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                if (r == DialogResult.Yes)
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = setupPath,
                            UseShellExecute = true,
                        });
                    }
                    catch (Exception ex)
                    {
                        Log(logPath, "manual open fail " + ex.Message);
                    }
                }
                return 1;
            }

            ui.Show();
            ui.SetStatus("安装结束，正在启动画布…");
            Application.DoEvents();

            bool launched = false;
            for (int i = 0; i < 20; i++)
            {
                if (IsAppRunning(AppProcessName))
                {
                    launched = true;
                    break;
                }
                if (i == 1 || i == 4 || i == 8) TryLaunchApp(logPath);
                Thread.Sleep(1000);
                Application.DoEvents();
            }

            if (!launched)
            {
                TryLaunchApp(logPath);
                Thread.Sleep(2000);
                launched = IsAppRunning(AppProcessName);
            }

            if (launched)
            {
                ui.SetStatus("更新完成。本窗口即将关闭。");
                Application.DoEvents();
                Thread.Sleep(2000);
                Log(logPath, "done ok launched");
                return 0;
            }

            ui.Hide();
            MessageBox.Show(
                "安装可能已完成，但未能自动打开画布。\n请从开始菜单打开「聚梦无限画布」。\n\n"
                    + "若仍是旧版，请手动运行：\n" + setupPath + "\n\n日志：" + logPath,
                "聚梦无限画布 · 更新助手",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            Log(logPath, "done but app not detected");
            return 0;
        }
        catch (Exception ex)
        {
            Log(logPath, "FAIL " + ex);
            try
            {
                if (ui != null) ui.Hide();
                MessageBox.Show(
                    "更新失败：" + ex.Message + "\n\n官网完整安装包：\n" + FullSetupUrl
                        + "\n\n日志：" + logPath,
                    "聚梦无限画布 · 更新助手",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            catch { /* ignore */ }
            return 1;
        }
        finally
        {
            if (ui != null)
            {
                try { ui.Close(); ui.Dispose(); } catch { /* ignore */ }
            }
        }
    }

    static int RelaunchShellExecute(string self, string argLine, string logPath)
    {
        var psi = new ProcessStartInfo
        {
            FileName = self,
            Arguments = argLine,
            UseShellExecute = true,
        };
        using (var p = Process.Start(psi))
        {
            if (p == null) return 1;
            p.WaitForExit();
            Log(logPath, "shell relaunch exit=" + p.ExitCode);
            return p.ExitCode;
        }
    }

    static string SelfPath()
    {
        try
        {
            return Assembly.GetExecutingAssembly().Location;
        }
        catch
        {
            return Process.GetCurrentProcess().MainModule.FileName;
        }
    }

    static void WaitAppExit(string name, int seconds, ProgressForm ui, string logPath)
    {
        var deadline = DateTime.UtcNow.AddSeconds(seconds);
        while (DateTime.UtcNow < deadline)
        {
            if (!IsAppRunning(name))
            {
                Log(logPath, "app exited");
                return;
            }
            ui.SetStatus("正在等待「聚梦无限画布」完全退出（请勿再打开）…");
            Application.DoEvents();
            Thread.Sleep(1000);
        }
        Log(logPath, "wait app exit timeout — continue anyway");
    }

    static bool IsAppRunning(string name)
    {
        try
        {
            var list = Process.GetProcessesByName(name);
            if (list != null && list.Length > 0)
            {
                foreach (var p in list) try { p.Dispose(); } catch { }
                return true;
            }
            foreach (var p in Process.GetProcesses())
            {
                try
                {
                    string n = p.ProcessName ?? "";
                    if (n.IndexOf("聚梦", StringComparison.Ordinal) >= 0
                        || n.IndexOf("JumengCanvas", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        p.Dispose();
                        return true;
                    }
                    p.Dispose();
                }
                catch
                {
                    try { p.Dispose(); } catch { }
                }
            }
            return false;
        }
        catch
        {
            return false;
        }
    }

    static void EnsureFreshSetup(string url, string dest, ProgressForm ui, string logPath)
    {
        long remoteLen = 0;
        try
        {
            remoteLen = ProbeContentLength(url);
            Log(logPath, "remote Content-Length=" + remoteLen);
        }
        catch (Exception ex)
        {
            Log(logPath, "HEAD fail: " + ex.Message);
        }

        if (File.Exists(dest))
        {
            long local = new FileInfo(dest).Length;
            bool sizeOk = remoteLen > MinSetupBytes
                ? local == remoteLen
                : local >= MinSetupBytes && IsMz(dest);
            if (sizeOk && IsMz(dest))
            {
                Log(logPath, "reuse temp setup bytes=" + local);
                ui.SetProgress(100);
                return;
            }
            Log(logPath, "temp setup stale local=" + local + " remote=" + remoteLen);
            try { File.Delete(dest); } catch { /* ignore */ }
        }

        DownloadSetup(url, dest, ui, logPath);
        if (!IsValidSetup(dest, remoteLen))
        {
            throw new Exception(
                "安装包下载不完整。请检查网络后重试，或浏览器打开：\n" + url);
        }
    }

    static long ProbeContentLength(string url)
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        var req = (HttpWebRequest)WebRequest.Create(url);
        req.Method = "HEAD";
        req.UserAgent = "JumengCanvas-UpdateBootstrap/1.2";
        req.Timeout = 30000;
        req.AllowAutoRedirect = true;
        using (var resp = (HttpWebResponse)req.GetResponse())
        {
            return resp.ContentLength;
        }
    }

    static void DownloadSetup(string url, string dest, ProgressForm ui, string logPath)
    {
        string partial = dest + ".partial";
        try { if (File.Exists(partial)) File.Delete(partial); } catch { /* ignore */ }

        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        using (var wc = new WebClient())
        {
            wc.Headers["User-Agent"] = "JumengCanvas-UpdateBootstrap/1.2";
            var done = new ManualResetEvent(false);
            Exception error = null;
            wc.DownloadProgressChanged += (s, e) =>
            {
                ui.SetProgress(e.ProgressPercentage);
                long mbRecv = e.BytesReceived / (1024 * 1024);
                long mbTotal = e.TotalBytesToReceive > 0 ? e.TotalBytesToReceive / (1024 * 1024) : 0;
                ui.SetStatus(string.Format(
                    "正在下载完整安装包… {0}%（{1}/{2} MB）\n请保持网络畅通。",
                    e.ProgressPercentage, mbRecv, mbTotal));
                try { Application.DoEvents(); } catch { }
            };
            wc.DownloadFileCompleted += (s, e) =>
            {
                if (e.Error != null) error = e.Error;
                else if (e.Cancelled) error = new Exception("下载已取消");
                done.Set();
            };
            Log(logPath, "download begin " + url);
            wc.DownloadFileAsync(new Uri(url), partial);
            while (!done.WaitOne(50))
            {
                Application.DoEvents();
            }
            if (error != null) throw error;
        }

        if (File.Exists(dest))
        {
            try { File.Delete(dest); } catch { /* ignore */ }
        }
        File.Move(partial, dest);
        Log(logPath, "downloaded bytes=" + new FileInfo(dest).Length);
    }

    static bool IsMz(string path)
    {
        try
        {
            using (var fs = File.OpenRead(path))
            {
                return fs.ReadByte() == 0x4D && fs.ReadByte() == 0x5A;
            }
        }
        catch { return false; }
    }

    static bool IsValidSetup(string path, long expectedLen)
    {
        try
        {
            if (!File.Exists(path)) return false;
            var fi = new FileInfo(path);
            if (fi.Length < MinSetupBytes) return false;
            if (expectedLen > MinSetupBytes && fi.Length != expectedLen) return false;
            return IsMz(path);
        }
        catch { return false; }
    }

    static int RunInstallerVisible(string setupPath, string logPath)
    {
        // start /WAIT 打开，尽量保证向导可见
        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = "/c start \"JumengSetup\" /WAIT \"" + setupPath + "\"",
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        Log(logPath, "start visible installer via cmd start");
        using (var p = Process.Start(psi))
        {
            if (p == null) return -1;
            p.WaitForExit();
            try { return p.ExitCode; }
            catch { return 0; }
        }
    }

    static void TryLaunchApp(string logPath)
    {
        string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string[] candidates = new string[]
        {
            Path.Combine(localApp, "Programs", "聚梦无限画布", "聚梦无限画布.exe"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
                "Programs", ShortcutName),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu),
                "Programs", ShortcutName),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                ShortcutName),
        };
        foreach (var c in candidates)
        {
            try
            {
                if (File.Exists(c))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = "/c start \"\" \"" + c + "\"",
                        UseShellExecute = false,
                        CreateNoWindow = true,
                    });
                    Log(logPath, "launched " + c);
                    return;
                }
            }
            catch (Exception ex)
            {
                Log(logPath, "launch fail " + c + " " + ex.Message);
            }
        }
        Log(logPath, "no launch target found");
    }

    static void Log(string path, string msg)
    {
        try
        {
            File.AppendAllText(path, DateTime.Now.ToString("o") + " " + msg + Environment.NewLine);
        }
        catch { /* ignore */ }
    }
}

internal sealed class ProgressForm : Form
{
    readonly Label _status;
    readonly ProgressBar _bar;

    public ProgressForm()
    {
        Text = "聚梦无限画布 · 更新助手";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ControlBox = true;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(480, 140);
        TopMost = true;
        ShowInTaskbar = true;

        _status = new Label
        {
            AutoSize = false,
            Location = new Point(16, 16),
            Size = new Size(448, 56),
            Text = "准备中…",
        };
        _bar = new ProgressBar
        {
            Location = new Point(16, 88),
            Size = new Size(448, 24),
            Minimum = 0,
            Maximum = 100,
            Style = ProgressBarStyle.Continuous,
        };
        Controls.Add(_status);
        Controls.Add(_bar);
    }

    public void SetStatus(string text)
    {
        if (InvokeRequired) { BeginInvoke(new Action(() => SetStatus(text))); return; }
        _status.Text = text ?? "";
    }

    public void SetProgress(int percent)
    {
        if (InvokeRequired) { BeginInvoke(new Action(() => SetProgress(percent))); return; }
        if (percent < 0) percent = 0;
        if (percent > 100) percent = 100;
        _bar.Value = percent;
    }
}
