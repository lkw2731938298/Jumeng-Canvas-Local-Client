' Simple error/info dialog for silent desktop launcher.
Option Explicit
Dim msg
If WScript.Arguments.Count < 1 Then
  msg = "Start failed"
Else
  msg = WScript.Arguments(0)
End If
MsgBox msg, 16, "Jumeng Open Canvas"
