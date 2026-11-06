package main

import (
	"os"
	"os/exec"
	"syscall"
	"unsafe"
)

var terminate = os.Interrupt // Windows has no SIGTERM

const createNoWindow = 0x08000000

func hide(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

func stop(cmd *exec.Cmd) {
	if cmd.Process != nil {
		cmd.Process.Kill()
		cmd.Process.Wait()
	}
}

func openBrowser(url string) error {
	return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func alert(title, msg string) {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(msg)
	const mbIconError = 0x10
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), mbIconError)
}
