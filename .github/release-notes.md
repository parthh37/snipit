## Install

**[⬇ Download Snipit-Setup.exe](https://github.com/{{REPO}}/releases/download/{{TAG}}/Snipit-Setup.exe)** (Windows 10/11, 64-bit) and run it.

- Installs in a few seconds for your Windows account, with **no admin rights needed**.
- Adds Snipit to the Start menu, starts it at login and puts it in the system tray (look for
  the Snipit icon by the clock, or under the **^** arrow).
- Installs Microsoft Edge WebView2 if the PC doesn't have it yet.
- Updates itself from then on.

**For everyone on a PC, or IT deployment:** use
[Snipit-Setup.msi](https://github.com/{{REPO}}/releases/download/{{TAG}}/Snipit-Setup.msi)
instead. It installs for all users and needs admin rights
(`msiexec /i Snipit-Setup.msi /qn` installs silently).

> **"Windows protected your PC"?** The installer isn't code-signed yet, so SmartScreen
> warns about it. Click **More info → Run anyway**. `SHA256SUMS.txt` below lists the
> checksum of every file.
