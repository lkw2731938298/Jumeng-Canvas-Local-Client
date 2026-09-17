' Launch 启动本机画布.bat with a hidden console (WindowStyle 0).
Option Explicit
Dim sh, bat, fso
If WScript.Arguments.Count < 1 Then WScript.Quit 1
bat = WScript.Arguments(0)
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(bat)
' 0 = hidden; False = do not wait (Node keeps running in background)
sh.Run """" & bat & """ --hidden", 0, False
