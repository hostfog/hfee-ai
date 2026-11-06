//go:build !windows

package main

import (
	"os/exec"
	"runtime"
	"syscall"
	"time"
)

var terminate = syscall.SIGTERM

func hide(cmd *exec.Cmd) {}

// stop asks a child to exit and kills it if it has not after five seconds.
func stop(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	cmd.Process.Signal(syscall.SIGTERM)
	exited := make(chan struct{})
	go func() { cmd.Process.Wait(); close(exited) }()
	select {
	case <-exited:
	case <-time.After(5 * time.Second):
		cmd.Process.Kill()
	}
}

func openBrowser(url string) error {
	if runtime.GOOS == "darwin" {
		return exec.Command("open", url).Start()
	}
	return exec.Command("xdg-open", url).Start()
}

func alert(title, msg string) {
	if runtime.GOOS == "darwin" {
		exec.Command("osascript", "-e", `display alert "`+title+`" message "`+escape(msg)+`" as critical`).Run()
		return
	}
	if exec.Command("zenity", "--error", "--title="+title, "--text="+msg).Run() != nil {
		println(title + ": " + msg)
	}
}

func escape(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if r == '"' || r == '\\' {
			out = append(out, '\\')
		}
		out = append(out, r)
	}
	return string(out)
}
