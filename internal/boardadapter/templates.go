package boardadapter

import (
	"bytes"
	"embed"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"

	"github.com/artipop/xciii/server/app"
	"github.com/artipop/xciii/server/mlog"
	"github.com/artipop/xciii/server/model"
)

// The board templates this app ships are ours, and they live here. The server
// module ships its own — a sales pipeline, a retrospective — and those are the
// upstream's examples: they know nothing about columns that run an agent, so a
// board made from one arrives with no automation at all. Ours carry it, which
// is why the selector offers these and hides the upstream ones
// (VISIBLE_TEMPLATE_SLUGS in the webapp). A template the user made is offered
// whatever it carries — it is theirs, and they can see what is in it.
//
// The format is what the board server imports, one board per file: the first
// line is the board, the rest its cards, views and content. Authoring one by
// hand is possible but not the intended way — build the board in the app and
// export it (board menu → *Export board archive*), then unzip the archive and
// keep the board.jsonl.

//go:embed templates/*.jsonl
var templateFiles embed.FS

// TemplateVersion is bumped to push edited templates into installs that already
// have them. Nothing else re-imports: a template somebody has since changed is
// theirs until this number moves, and then it is replaced.
// 11: the board keys the templates carry were renamed acp* → xciii*. A stale
// template would go on making boards under the old names — read, but never the
// ones anything writes, so every such board would carry both.
// 12: the developer template's test column is «QA», and its route names the
// stage `qa` rather than `test`.
// 13: the board's description is hidden until somebody asks for it.
// 14: «Контент» joins the set — content making with an agent writing the brief
// and the draft and a person reading them; no deploy, no browser test, so its
// setup wizard asks for a folder and an agent and nothing else.
// 15: «Мои задачи» stands beside «Входящие» — the column a card made with the
// inbox's own «Создать» button lands in, so what a person typed is not filed
// among what arrived and nobody has read.
// 16: the developer template's main view is «Задачи» — «Progress Tracker» was
// the one English name left on a Russian screen, inherited from the upstream
// board the template was built from.
const TemplateVersion = 16

// TemplateMarkerProperty is the board property each template carries its slug
// in. Ids are regenerated on import and titles are the user's to change, so the
// marker is the only thing that still says "this board came from that file".
const TemplateMarkerProperty = "xciiiTemplate"

// ImportTemplates makes the app's own templates exist in the global team, and
// keeps them at the version this build ships. It is safe to call on every
// launch: a template that is already there at the right version is left alone.
func ImportTemplates(a *app.App, log mlog.LoggerIFace) error {
	if err := importTemplates(a, log, TemplateVersion); err != nil {
		return err
	}
	renameLegacyViews(a, log)
	return nil
}

// renameLegacyViews catches up boards the old templates already made. A version
// bump replaces the template, but a board made from it is the user's and is
// never replaced — so a name the template got wrong lives on there until it is
// mended in place. Only a title still byte-equal to what our own file shipped
// is touched: one somebody renamed is theirs. Safe to run on every launch —
// after the first pass nothing matches.
func renameLegacyViews(a *app.App, log mlog.LoggerIFace) {
	// The developer template's main view carried the name of the upstream
	// board it was built from (template version 16).
	const oldTitle, newTitle = "Progress Tracker", "Задачи"

	boards, err := a.GetBoardsForUserAndTeam(model.SingleUser, model.GlobalTeamID, false)
	if err != nil {
		log.Warn("templates: cannot list boards for the view rename", mlog.Err(err))
		return
	}
	for _, board := range boards {
		if board.IsTemplate || templateSlug(board) != "developer-tasks" {
			continue
		}
		// By type alone: a board duplicated from a template keeps its views'
		// parentId pointing at the template's own id, so filtering on the
		// board as parent finds nothing there.
		views, err := a.GetBlocks(board.ID, "", model.TypeView)
		if err != nil {
			log.Warn("templates: cannot read views for the view rename", mlog.String("board", board.ID), mlog.Err(err))
			continue
		}
		for _, view := range views {
			if view.Title != oldTitle {
				continue
			}
			title := newTitle
			if _, err := a.PatchBlock(view.ID, &model.BlockPatch{Title: &title}, model.SystemUserID); err != nil {
				log.Warn("templates: cannot rename the view", mlog.String("board", board.ID), mlog.Err(err))
				continue
			}
			log.Info("templates: renamed the legacy view", mlog.String("board", board.ID))
		}
	}
}

// importTemplates takes the version as an argument so a test can install an
// older set and watch the newer one replace it — the path that only ever runs
// on an upgrade, and the one that would quietly leave two copies if it broke.
func importTemplates(a *app.App, log mlog.LoggerIFace, version int) error {
	files, err := fs.Glob(templateFiles, "templates/*.jsonl")
	if err != nil {
		return fmt.Errorf("read the shipped templates: %w", err)
	}
	sort.Strings(files)

	existing, err := a.GetTemplateBoards(model.GlobalTeamID, "")
	if err != nil {
		return fmt.Errorf("read the templates already installed: %w", err)
	}
	installed := make(map[string]*model.Board, len(existing))
	for _, board := range existing {
		if slug := templateSlug(board); slug != "" {
			installed[slug] = board
		}
	}

	for _, file := range files {
		slug := strings.TrimSuffix(path.Base(file), ".jsonl")
		if board, ok := installed[slug]; ok {
			if board.TemplateVersion >= version {
				continue
			}
			// Replaced rather than patched: a template is a whole board, and
			// merging one into another has no meaning a person could predict.
			if err := a.DeleteBoard(board.ID, model.SystemUserID); err != nil {
				log.Warn("templates: cannot remove the old copy", mlog.String("template", slug), mlog.Err(err))
				continue
			}
		}
		data, err := templateFiles.ReadFile(file)
		if err != nil {
			return fmt.Errorf("read %s: %w", file, err)
		}
		if _, err := a.ImportBoardJSONL(bytes.NewReader(data), templateImportOptions(version)); err != nil {
			// One unreadable template must not cost the others: the app is
			// usable without it, and the log says which one to look at.
			log.Error("templates: cannot install", mlog.String("template", slug), mlog.Err(err))
			continue
		}
		log.Info("templates: installed", mlog.String("template", slug))
	}
	return nil
}

func templateImportOptions(version int) model.ImportArchiveOptions {
	return model.ImportArchiveOptions{
		TeamID:     model.GlobalTeamID,
		ModifiedBy: model.SystemUserID,
		BoardModifier: func(board *model.Board, cache map[string]interface{}) bool {
			return asTemplate(board, version)
		},
	}
}

// asTemplate is where a file becomes a template, rather than each file having
// to say so: open (so it is offered without anybody being a member of it) and
// stamped with the version that decides when it is replaced.
func asTemplate(board *model.Board, version int) bool {
	board.IsTemplate = true
	board.Type = model.BoardTypeOpen
	board.TemplateVersion = version
	board.CreatedBy = model.SystemUserID
	return true
}

func templateSlug(board *model.Board) string {
	if board == nil || board.Properties == nil {
		return ""
	}
	slug, _ := board.Properties[TemplateMarkerProperty].(string)
	return slug
}
