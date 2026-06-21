using System.Diagnostics;
using System.Runtime.InteropServices;

namespace FireLogistics.Core.Infrastructure;

public static class ProcessTreeMemory
{
    public static long GetCurrentProcessWorkingSetBytes()
    {
        try
        {
            using Process currentProcess = Process.GetCurrentProcess();
            return Math.Max(0, currentProcess.WorkingSet64);
        }
        catch
        {
            return 0;
        }
    }

    public static long GetProcessTreeWorkingSetBytes()
    {
        try
        {
            using Process currentProcess = Process.GetCurrentProcess();
            HashSet<int> processIds = CollectProcessTreeIds(currentProcess.Id);
            long total = 0;
            foreach (int processId in processIds)
            {
                try
                {
                    using Process process = Process.GetProcessById(processId);
                    total += Math.Max(0, process.WorkingSet64);
                }
                catch (InvalidOperationException)
                {
                }
                catch (ArgumentException)
                {
                }
            }

            return total;
        }
        catch
        {
            return GetCurrentProcessWorkingSetBytes();
        }
    }

    private static HashSet<int> CollectProcessTreeIds(int rootProcessId)
    {
        Dictionary<int, List<int>> childrenByParent = BuildParentChildMap();
        var processIds = new HashSet<int> { rootProcessId };
        var queue = new Queue<int>();
        queue.Enqueue(rootProcessId);
        while (queue.Count > 0)
        {
            int parentId = queue.Dequeue();
            if (!childrenByParent.TryGetValue(parentId, out List<int>? children))
            {
                continue;
            }

            foreach (int childId in children)
            {
                if (processIds.Add(childId))
                {
                    queue.Enqueue(childId);
                }
            }
        }

        return processIds;
    }

    private static Dictionary<int, List<int>> BuildParentChildMap()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return BuildParentChildMapWindows();
        }

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            return BuildParentChildMapLinux();
        }

        return [];
    }

    private static Dictionary<int, List<int>> BuildParentChildMapWindows()
    {
        var childrenByParent = new Dictionary<int, List<int>>();
        IntPtr snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snapshot == INVALID_HANDLE_VALUE)
        {
            return childrenByParent;
        }

        try
        {
            PROCESSENTRY32 entry = new() { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32>() };
            if (!Process32First(snapshot, ref entry))
            {
                return childrenByParent;
            }

            do
            {
                AddChild(childrenByParent, (int)entry.th32ParentProcessID, (int)entry.th32ProcessID);
            }
            while (Process32Next(snapshot, ref entry));
        }
        finally
        {
            CloseHandle(snapshot);
        }

        return childrenByParent;
    }

    private static Dictionary<int, List<int>> BuildParentChildMapLinux()
    {
        var childrenByParent = new Dictionary<int, List<int>>();
        foreach (string procDir in Directory.EnumerateDirectories("/proc"))
        {
            string dirName = Path.GetFileName(procDir);
            if (!int.TryParse(dirName, out int processId))
            {
                continue;
            }

            string statusPath = Path.Combine(procDir, "status");
            if (!File.Exists(statusPath))
            {
                continue;
            }

            foreach (string line in File.ReadLines(statusPath))
            {
                if (!line.StartsWith("PPid:", StringComparison.Ordinal))
                {
                    continue;
                }

                string value = line["PPid:".Length..].Trim();
                if (int.TryParse(value, out int parentId))
                {
                    AddChild(childrenByParent, parentId, processId);
                }

                break;
            }
        }

        return childrenByParent;
    }

    private static void AddChild(Dictionary<int, List<int>> childrenByParent, int parentId, int childId)
    {
        if (parentId <= 0 || childId <= 0 || parentId == childId)
        {
            return;
        }

        if (!childrenByParent.TryGetValue(parentId, out List<int>? children))
        {
            children = [];
            childrenByParent[parentId] = children;
        }

        children.Add(childId);
    }

    private const uint TH32CS_SNAPPROCESS = 0x00000002;
    private static readonly IntPtr INVALID_HANDLE_VALUE = new(-1);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PROCESSENTRY32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }
}
