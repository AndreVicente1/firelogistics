using System.Diagnostics;

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
}
