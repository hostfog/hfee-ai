// Command hfee-ai is the desktop app. It starts the HFee model runner and the
// HFee AI website on this computer, then opens the site in the browser.
// Choosing Quit in the site stops both.
//
// It expects this layout next to the executable (Contents/Resources on macOS):
//
//	hfee            the model runner
//	node/node       Node.js 22
//	site/           the website (server/, dist/, node_modules/)
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"time"
)

const (
	runnerAddr   = "127.0.0.1:11500" // same default as the hfee CLI, so models are shared
	siteAddr     = "127.0.0.1:11501"
	defaultModel = "qwen2.5:3b"
)

func main() {
	if err := run(); err != nil {
		alert("HFee AI could not start", err.Error())
		os.Exit(1)
	}
}

func run() error {
	siteURL := "http://" + siteAddr

	// Already running: just bring it up again.
	if up(siteURL + "/api/health") {
		show(siteURL)
		return nil
	}

	res, err := resourceDir()
	if err != nil {
		return err
	}
	data, err := dataDir()
	if err != nil {
		return err
	}
	logs := filepath.Join(data, "logs")
	if err := os.MkdirAll(logs, 0o755); err != nil {
		return err
	}

	var runner *exec.Cmd
	if !up("http://" + runnerAddr + "/api/version") {
		runner, err = start(filepath.Join(logs, "hfee.log"), filepath.Join(res, exe("hfee")), "serve")
		if err != nil {
			return fmt.Errorf("starting the model runner: %w", err)
		}
		runner.Env = append(os.Environ(), "HFEE_HOST="+runnerAddr, "HFEE_NUM_PARALLEL=2")
		if err := runner.Start(); err != nil {
			return fmt.Errorf("starting the model runner: %w", err)
		}
		defer stop(runner)
		if !waitUp("http://"+runnerAddr+"/api/version", 30*time.Second) {
			return fmt.Errorf("the model runner did not start; see %s", filepath.Join(logs, "hfee.log"))
		}
	}

	site, err := start(filepath.Join(logs, "site.log"),
		filepath.Join(res, "node", exe("node")),
		"--disable-warning=ExperimentalWarning", filepath.Join("server", "index.js"))
	if err != nil {
		return err
	}
	site.Dir = filepath.Join(res, "site")
	site.Env = append(os.Environ(),
		"DESKTOP=true",
		"SINGLE_USER=true",
		"ALLOW_SIGNUP=false",
		"HOST=127.0.0.1",
		"PORT="+portOf(siteAddr),
		"AI_BASE_URL=http://"+runnerAddr+"/v1",
		"AI_MODEL="+defaultModel,
		"MAX_PARALLEL=2",
		"DB_PATH="+filepath.Join(data, "hfee.db"),
	)
	if err := site.Start(); err != nil {
		return fmt.Errorf("starting the website: %w", err)
	}
	if !waitUp(siteURL+"/api/health", 30*time.Second) {
		stop(site)
		return fmt.Errorf("the website did not start; see %s", filepath.Join(logs, "site.log"))
	}
	show(siteURL)

	// Run until the site exits (Quit) or the system asks us to stop.
	done := make(chan error, 1)
	go func() { done <- site.Wait() }()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, terminate)
	select {
	case <-done:
	case <-sig:
		stop(site)
	}
	return nil
}

// show opens the site, or says where it is if no browser could be opened.
func show(url string) {
	if openBrowser(url) != nil {
		alert("HFee AI is running", "Open "+url+" in your browser.")
	}
}

// resourceDir is where the bundled runner, Node.js and site live.
func resourceDir() (string, error) {
	self, err := os.Executable()
	if err != nil {
		return "", err
	}
	self, err = filepath.EvalSymlinks(self)
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(self)
	if runtime.GOOS == "darwin" {
		return filepath.Join(dir, "..", "Resources"), nil
	}
	return dir, nil
}

// dataDir holds chats and settings: %AppData%\HFee AI, ~/Library/Application
// Support/HFee AI or ~/.config/hfee-ai. Models stay in ~/.hfee like the CLI.
func dataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	name := "HFee AI"
	if runtime.GOOS == "linux" {
		name = "hfee-ai"
	}
	return filepath.Join(base, name), nil
}

// start prepares a hidden child process that logs to file.
func start(logPath, name string, args ...string) (*exec.Cmd, error) {
	if _, err := os.Stat(name); err != nil {
		return nil, fmt.Errorf("missing %s; please reinstall HFee AI", filepath.Base(name))
	}
	log, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(name, args...)
	cmd.Stdout, cmd.Stderr = log, log
	hide(cmd)
	return cmd, nil
}

func up(url string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	res.Body.Close()
	return res.StatusCode == http.StatusOK
}

func waitUp(url string, limit time.Duration) bool {
	for deadline := time.Now().Add(limit); time.Now().Before(deadline); time.Sleep(200 * time.Millisecond) {
		if up(url) {
			return true
		}
	}
	return false
}

func exe(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

func portOf(addr string) string {
	return addr[len("127.0.0.1:"):]
}
