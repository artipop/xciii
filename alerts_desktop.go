//go:build !server

package main

import (
	"context"
	_ "embed"
	"log"
	"runtime"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"

	"github.com/artipop/xciii/internal/acp"
)

// The menu bar and the OS notification centre, driven by the one thing they are
// both about: which agents are waiting for a person. alerts.go says why they
// exist and where the line between them falls.
//
// The icons are two inks rather than one macOS template icon, because the badge
// is the point: a template icon is drawn from its alpha alone, so the amber
// would come out the same grey as the mark. macOS and Linux take one icon and
// never ask for a second (their SetDarkModeIcon is SetIcon), so which ink is
// right is ours to decide and ours to redecide when the system theme changes;
// Windows keeps both and swaps them itself. build/appicon.py draws all four.

//go:embed build/tray/idle-light.png
var trayIdleLight []byte

//go:embed build/tray/idle-dark.png
var trayIdleDark []byte

//go:embed build/tray/waiting-light.png
var trayWaitingLight []byte

//go:embed build/tray/waiting-dark.png
var trayWaitingDark []byte

// trayWaitCap is how many waiting agents the menu lists by name before it
// starts counting them instead. A menu bar menu is read standing up.
const trayWaitCap = 6

type alertController struct {
	wapp *application.App
	app  *App
	mgr  *acp.Manager

	// notifier is the OS notification centre, or nil where there is none to
	// reach: on macOS it needs a bundled, signed app, so a `wails3 dev` build
	// has the menu bar and nothing else.
	notifier *notifications.NotificationService
	granted  atomic.Bool
	asked    sync.Once

	tray *application.SystemTray

	// mu serialises a whole refresh: attention events are dispatched one
	// goroutine each, and two of them racing would leave the menu describing
	// one list and told describing another.
	mu   sync.Mutex
	told map[string]bool
}

// initAlerts puts the menu bar icon up and starts announcing waits, and returns
// what stops it. Nothing happens without the agent integration: an install with
// no agents has nothing that could ask for a person, and an icon that can never
// change is an icon that is only in the way.
func initAlerts(wapp *application.App, app *App, mgr *acp.Manager) func() {
	if mgr == nil {
		return func() {}
	}
	c := &alertController{wapp: wapp, app: app, mgr: mgr, told: map[string]bool{}}

	// The notification service is started by hand rather than registered in
	// application.Options.Services, and that is not a shortcut: a service whose
	// ServiceStartup returns an error takes the whole application down with it,
	// and on macOS this one fails whenever the binary is not a bundle — which is
	// every `wails3 dev` run there is. Notifications are worth having and they
	// are not worth the app.
	ns := notifications.New()
	if err := ns.ServiceStartup(context.Background(), application.ServiceOptions{}); err != nil {
		log.Printf("alerts: no OS notifications (%v)", err)
	} else {
		c.notifier = ns
		ns.OnNotificationResponse(c.notificationClicked)
	}

	c.tray = wapp.SystemTray.New()
	c.tray.SetIcon(trayIdleDark)
	c.tray.SetMenu(c.menu(nil))

	// Left click is the app, right click is the menu — which is what a status
	// item is for on every platform this builds for, and it is only true if a
	// click handler exists: with none, the platform takes the left button for
	// the menu itself and there is no way to simply open the app from here.
	// The right button is left alone, which is what makes it the menu's.
	c.tray.OnClick(func() { go showMainWindow(c.wapp, c.app.originURL()) })

	// The list is re-read rather than taken from the payload: a wait ending and
	// a wait being acknowledged arrive as the same event, and what both the dot
	// and the notifications need is the whole picture afterwards.
	stop := wapp.Event.On(acp.EventAttention, func(*application.CustomEvent) { c.refresh() })

	// The first refresh has to wait for the application to be running: until
	// then there is no platform behind the tray and no answer to "is the system
	// in dark mode", so an icon set now would be set in the dark and never
	// corrected.
	wapp.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) { c.refresh() })
	wapp.Event.OnApplicationEvent(events.Common.ThemeChanged, func(*application.ApplicationEvent) { c.refresh() })

	return func() {
		stop()
		if c.notifier != nil {
			_ = c.notifier.ServiceShutdown()
		}
	}
}

// refresh redraws the menu bar and says whatever is newly worth saying.
func (c *alertController) refresh() {
	waiting := c.mgr.Attention()

	// Read before the lock: both of these can block — one on a file, the other
	// on the main thread — and neither has anything to do with what is told.
	announce := agentNotificationsEnabled() && !c.appFocused()

	c.mu.Lock()
	defer c.mu.Unlock()

	c.drawTray(waiting)

	fresh, stale := alertPlan(c.told, waiting)
	for _, key := range stale {
		delete(c.told, key)
		if c.notifier != nil {
			// A wait a person has dealt with must not go on standing in the
			// notification centre: they answered it in the terminal, on the
			// card, on another window, or on their phone.
			//
			// RemoveDeliveredNotification and not RemoveNotification, which is
			// the one that reads like the right call and is a stub returning
			// nil on macOS and on Windows. Delivered is what ours are — nothing
			// here schedules — and on Linux the two are the same method.
			_ = c.notifier.RemoveDeliveredNotification(key)
		}
	}
	if !announce || len(fresh) == 0 || c.notifier == nil {
		return
	}
	if !c.granted.Load() {
		// Permission is asked the first time there is something to say, rather
		// than on the launch path: an install whose owner never runs an agent is
		// never interrupted to be asked. The wait that provoked the question is
		// not announced — the system's own dialog is on the screen instead — and
		// it is not recorded as told, so the next thing that happens announces it.
		c.authorise()
		return
	}
	for _, a := range fresh {
		if err := c.notifier.SendNotification(notifications.NotificationOptions{
			ID:    a.Key,
			Title: alertTitle(a),
			Body:  alertBody(a),
			// The key is all the click needs; the rest of the wait is looked up
			// again, because by then it may have ended.
			Data:     map[string]any{"key": a.Key},
			ThreadID: "acp-attention",
		}); err != nil {
			log.Printf("alerts: %v", err)
			continue
		}
		c.told[a.Key] = true
	}
}

// appFocused reports whether the person is in this app at all — any window of
// it, not only the board's. A terminal window is the app too, and announcing a
// wait to somebody who is sitting in front of the agent's own screen is the
// noise this whole feature is supposed to be the opposite of.
func (c *alertController) appFocused() bool {
	for _, win := range c.wapp.Window.GetAll() {
		if win.IsFocused() {
			return true
		}
	}
	return false
}

// authorise asks the system for permission, once per launch and off the calling
// goroutine: the request blocks until the person answers the dialog, which may
// be minutes.
func (c *alertController) authorise() {
	c.asked.Do(func() {
		go func() {
			if ok, err := c.notifier.CheckNotificationAuthorization(); err == nil && ok {
				c.granted.Store(true)
				return
			}
			ok, err := c.notifier.RequestNotificationAuthorization()
			if err != nil {
				log.Printf("alerts: notifications not authorised (%v)", err)
				return
			}
			c.granted.Store(ok)
		}()
	})
}

// drawTray puts the dot up or takes it down, and rebuilds the menu behind it.
//
// The dot follows the waits themselves and not the notification setting: it is
// an indicator, like the amber button on the card, and somebody who turned the
// interruption off still wants to be able to find out by looking.
func (c *alertController) drawTray(waiting []acp.Attention) {
	if c.tray == nil {
		return
	}
	light, dark := trayIdleLight, trayIdleDark
	if len(waiting) > 0 {
		light, dark = trayWaitingLight, trayWaitingDark
	}
	if runtime.GOOS == "windows" {
		c.tray.SetIcon(light)
		c.tray.SetDarkModeIcon(dark)
	} else if c.wapp.Env.IsDarkMode() {
		c.tray.SetIcon(dark)
	} else {
		c.tray.SetIcon(light)
	}
	c.tray.SetMenu(c.menu(waiting))
}

// menu is the way in from the menu bar: back to the board, or straight to
// whichever agent is asking. Nothing here answers anything — the agent drew its
// question in its own terminal, and this is the way to it.
func (c *alertController) menu(waiting []acp.Attention) *application.Menu {
	menu := application.NewMenu()
	menu.Add("Открыть").OnClick(func(*application.Context) {
		go showMainWindow(c.wapp, c.app.originURL())
	})
	if len(waiting) > 0 {
		menu.AddSeparator()
		for i, a := range waiting {
			if i == trayWaitCap {
				menu.Add(hiddenWaitsLabel(len(waiting) - trayWaitCap))
				break
			}
			menu.Add(alertMenuLabel(a)).OnClick(func(*application.Context) { go c.openWait(a) })
		}
	}

	// The way out, and the only one there is once the board's window is closed:
	// the app goes on running without it, so ⌘Q has nothing to be pressed in
	// front of. It also ends every agent CLI, which is why it is the last item
	// and behind a separator rather than beside «Открыть».
	menu.AddSeparator()
	menu.Add("Выход").OnClick(func(*application.Context) { go requestQuit(c.wapp) })
	return menu
}

// notificationClicked is somebody answering the notification by going to look,
// which is the only thing it offers.
func (c *alertController) notificationClicked(res notifications.NotificationResult) {
	if res.Error != nil {
		log.Printf("alerts: %v", res.Error)
		return
	}
	if res.Response.ActionIdentifier != notifications.DefaultActionIdentifier {
		return
	}
	key, _ := res.Response.UserInfo["key"].(string)
	for _, a := range c.mgr.Attention() {
		if a.Key == key {
			go c.openWait(a)
			return
		}
	}
	// The wait ended while the notification stood. The board is still the right
	// place to arrive at.
	go showMainWindow(c.wapp, c.app.originURL())
}

// openWait goes to where the agent is asking and counts as having been told —
// the same pair of acts the page's own notification performs (attention.ts),
// through the same acknowledgement, so going to look here takes the wait off
// every other window and off the phone.
func (c *alertController) openWait(a acp.Attention) {
	var err error
	switch {
	case a.TerminalID != "":
		_, err = c.app.ShowTerminal(a.TerminalID)
	case a.CardID != "":
		_, err = c.app.OpenCardTerminal(a.CardID, "", "", true)
	default:
		showMainWindow(c.wapp, c.app.originURL())
	}
	if err != nil {
		log.Printf("alerts: %v", err)
	}
	c.mgr.AckAttention(a.Key)
}
