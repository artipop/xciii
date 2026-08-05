// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

// bootstrapScript is injected into the served index.html <head>, before any app
// JS runs. It mirrors the init scripts of linux/main.go:
//   - seeds the single-user session token into localStorage,
//   - builds the bridge the webapp expects — window.go.main.App and
//     window.runtime — on top of the v3 runtime, and
//   - wires window.openInNewBrowser (a hook the webapp already calls for
//     external links, CSV export, etc.) to the bound App.OpenInBrowser method,
//     plus a catch-all that sends every outward link there.
//
// The bridge is what replaces v2's generated bindings. v3 injects nothing into
// the page: it serves /wails/runtime.js and the page loads it. So the shim
// imports that module once and turns every property read on
// window.go.main.App into Call.ByName('main.App.<name>', …) — the fully
// qualified name of a method on the bound App service — and window.runtime
// .EventsOn into Events.On, unwrapping the event object the v3 runtime passes
// (v2 handed the payload itself). The webapp therefore sees the same surface it
// saw under v2, feature detection included, and stays inert in browser and
// plugin builds where nothing injects this script at all.
//
// The catch-all runs in the capture phase and covers *every* absolute http(s)
// anchor, not just target=_blank ones without an inline handler. Markdown links
// (a card comment reporting a preview address, say) are rendered with an inline
// onclick calling openInNewBrowser, and an earlier version deferred to it —
// which left the link dead whenever that handler did not run, with nothing to
// see: the webview cannot navigate to an outside origin either, so a click did
// nothing at all. Capturing first and stopping propagation makes this the one
// path out, inline handler or not.
//
// There is deliberately no window.webSocketBaseURL here, which under v2 told
// the webapp's socket client the board server's own address. The page, the API
// and /ws now share one origin — the front door (frontdoor.go) — so the socket
// connects to where the page came from, as it does in a browser.
func bootstrapScript(sessionToken string) string {
	return fmt.Sprintf(`<script>
(function () {
  try { localStorage.setItem('xciiiSessionId', %q); } catch (e) {}

  // One import of the v3 runtime, started now so the module is ready by the
  // time the app's first binding call is made.
  var runtimePromise = null;
  function wailsRuntime() {
    if (!runtimePromise) {
      runtimePromise = import('/wails/runtime.js');
    }
    return runtimePromise;
  }
  wailsRuntime();

  // Anything read off the App object is a bound method; 'then' is excluded so
  // the object is never mistaken for a promise by an accidental await.
  var app = new Proxy({}, {
    get: function (_target, name) {
      if (typeof name !== 'string' || name === 'then') { return undefined; }
      return function () {
        var args = Array.prototype.slice.call(arguments);
        return wailsRuntime().then(function (rt) {
          return rt.Call.ByName('main.App.' + name, ...args);
        });
      };
    },
    has: function (_target, name) { return typeof name === 'string' && name !== 'then'; },
  });
  window.go = {main: {App: app}};
  window.runtime = {
    EventsOn: function (event, callback) {
      var off = null;
      var cancelled = false;
      wailsRuntime().then(function (rt) {
        if (cancelled) { return; }
        off = rt.Events.On(event, function (e) { callback(e && e.data); });
      });
      return function () {
        cancelled = true;
        if (off) { off(); off = null; }
      };
    },
  };

  window.openInNewBrowser = function (href) {
    if (href && window.go && window.go.main && window.go.main.App) {
      window.go.main.App.OpenInBrowser(href);
    }
  };
  document.addEventListener('click', function (e) {
    if (e.button !== 0 || e.defaultPrevented) { return; }
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) { return; }
    var href = a.href || a.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) { return; }
    // In-app navigation is same-origin and stays in the webview; anything
    // pointing outside is for the system browser.
    try {
      if (new URL(href, window.location.href).origin === window.location.origin) { return; }
    } catch (err) {}
    e.preventDefault();
    e.stopPropagation();
    window.openInNewBrowser(href);
  }, true);
})();
</script>`, sessionToken)
}

// newServerProxy builds a reverse proxy to the in-process board server.
// It sits behind the front door on everything except /wails/, so HTML, /api,
// /files and the /ws upgrade all reach localhost:port — the upgrade included,
// which is the one thing Wails' own asset server cannot forward. The bootstrap
// script is injected into HTML responses on the way back.
func newServerProxy(port int, sessionToken string) (http.Handler, error) {
	target, err := url.Parse(fmt.Sprintf("http://localhost:%d", port))
	if err != nil {
		return nil, err
	}

	proxy := httputil.NewSingleHostReverseProxy(target)

	baseDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		baseDirector(req)
		req.Host = target.Host
		// Ask upstream for uncompressed HTML so we can inject the bootstrap script.
		req.Header.Del("Accept-Encoding")
	}

	inject := []byte(bootstrapScript(sessionToken))
	proxy.ModifyResponse = func(resp *http.Response) error {
		if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html") {
			return nil
		}
		body, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if err != nil {
			return err
		}
		// Insert right after <head> so the token is set before app scripts load.
		if idx := bytes.Index(body, []byte("<head>")); idx != -1 {
			at := idx + len("<head>")
			body = append(body[:at], append(inject, body[at:]...)...)
		}
		resp.Body = io.NopCloser(bytes.NewReader(body))
		resp.ContentLength = int64(len(body))
		resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(body)))
		return nil
	}

	return proxy, nil
}
