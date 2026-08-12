import {readdirSync, readFileSync} from 'fs'
import {join} from 'path'

// The palette is one file, and this is what keeps it honest. Every pair below
// is text the product actually puts on that background; if a colour experiment
// makes one of them unreadable, this fails instead of shipping.
//
// It reads `_tokens.scss` rather than a copy of the values, so there is nothing
// to keep in sync.

const source = readFileSync(join(__dirname, '_tokens.scss'), 'utf8')

type Vars = Record<string, string>

// The file is three `:root` blocks: light, dark, and the derived layer both
// share. Parsed in order, later declarations winning, which is what the
// cascade does with them too.
function blocks(): Array<{selector: string, vars: Vars}> {
    const withoutComments = source.replace(/\/\/.*$/gm, '')
    const out: Array<{selector: string, vars: Vars}> = []
    const re = (/([^{}]+)\{([^{}]*)\}/g)
    let match = re.exec(withoutComments)
    while (match) {
        const vars: Vars = {}
        for (const line of match[2].split(';')) {
            const decl = (/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/).exec(line)
            if (decl) {
                vars[decl[1]] = decl[2]
            }
        }
        out.push({selector: match[1].trim(), vars})
        match = re.exec(withoutComments)
    }
    return out
}

function themeVars(dark: boolean): Vars {
    const vars: Vars = {}
    for (const block of blocks()) {
        const isDarkBlock = block.selector.includes('data-theme')
        if (isDarkBlock && !dark) {
            continue
        }
        Object.assign(vars, block.vars)
    }
    return vars
}

function resolve(vars: Vars, value: string, depth = 0): string {
    if (depth > 10) {
        throw new Error(`cycle resolving ${value}`)
    }
    const ref = (/^var\((--[\w-]+)\)$/).exec(value.trim())
    if (!ref) {
        return value.trim()
    }
    const next = vars[ref[1]]
    if (next === undefined) {
        throw new Error(`${ref[1]} is used but never defined`)
    }
    return resolve(vars, next, depth + 1)
}

// A token is either a bare `r, g, b` triple (so `rgba(var(--x), α)` works) or a
// hex colour, which is what the label palette uses.
function channels(vars: Vars, token: string): [number, number, number] {
    const raw = resolve(vars, vars[token] ?? `var(${token})`)
    const triple = raw.split(',').map((part) => Number(part.trim()))
    if (triple.length === 3 && triple.every((n) => Number.isFinite(n))) {
        return triple as [number, number, number]
    }
    const hex = (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i).exec(raw)
    if (!hex) {
        throw new Error(`${token} is neither an "r, g, b" triple nor a hex colour: ${raw}`)
    }
    const full = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance([r, g, b]: [number, number, number]): number {
    const channel = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return (0.2126 * channel(r)) + (0.7152 * channel(g)) + (0.0722 * channel(b))
}

function contrast(fg: [number, number, number], bg: [number, number, number]): number {
    const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
    return (a + 0.05) / (b + 0.05)
}

// Text drawn at less than full opacity is only as readable as what it composites
// to, and the product does that in several places — a label's text sits at 0.8.
function over(fg: [number, number, number], bg: [number, number, number], alpha: number): [number, number, number] {
    return [0, 1, 2].map((i) => (alpha * fg[i]) + ((1 - alpha) * bg[i])) as [number, number, number]
}

function stylesheets(dir: string): string[] {
    return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
            return stylesheets(path)
        }
        return entry.name.endsWith('.scss') ? [path] : []
    })
}

const AA = 4.5

const labels = [
    '--prop-default', '--prop-gray', '--prop-brown', '--prop-orange', '--prop-yellow',
    '--prop-green', '--prop-blue', '--prop-purple', '--prop-pink', '--prop-red',
]

describe('styles/tokens', () => {
    // Every token the stylesheets reach for has to exist. Ten of them did not:
    // `--center-channel-bg`, `--button-bg`, `--link-color` and the rest were
    // read in ~30 rules and defined nowhere, so those rules silently did
    // nothing until the palette moved into one file.
    it('defines every token it refers to', () => {
        for (const dark of [false, true]) {
            const vars = themeVars(dark)
            for (const name of Object.keys(vars)) {
                expect(() => resolve(vars, vars[name])).not.toThrow()
            }
        }
    })

    // And so does every stylesheet. This is the guard the first pass was
    // missing: it found the ten dead variables by hand and left two more —
    // `--error-text-color-rgb` and `--error-color`, names that never existed —
    // which meant eight rules across the agent dialogs drew error text in
    // whatever colour they happened to inherit.
    it('is asked for nothing that does not exist', () => {
        const light = themeVars(false)
        const dark = themeVars(true)
        const undefinedTokens = new Map<string, string[]>()

        for (const file of stylesheets(__dirname.replace(/\/styles$/, ''))) {
            const body = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '')
            if (file.endsWith('_tokens.scss')) {
                continue
            }

            // A file may declare tokens of its own — the terminal redeclares the
            // raw ones to make itself a dark island — and those are fine.
            const own = new Set(body.match(/(--[\w-]+)\s*:/g)?.map((d) => d.replace(/\s*:$/, '')) ?? [])
            for (const use of body.match(/var\((--[\w-]+)/g) ?? []) {
                const name = use.slice(4)
                if (own.has(name) || name in light || name in dark) {
                    continue
                }
                undefinedTokens.set(name, [...(undefinedTokens.get(name) ?? []), file])
            }
        }

        expect(Object.fromEntries(undefinedTokens)).toEqual({})
    })

    describe.each([['light', false], ['dark', true]] as const)('%s theme', (_name, dark) => {
        const vars = () => themeVars(dark)

        it('reads on the canvas and on a raised surface', () => {
            const ink = channels(vars(), '--center-channel-color-rgb')
            expect(contrast(ink, channels(vars(), '--center-channel-bg-rgb'))).toBeGreaterThanOrEqual(AA)
            expect(contrast(ink, channels(vars(), '--surface-bg-rgb'))).toBeGreaterThanOrEqual(AA)
        })

        // The dark theme puts near-black text on a bright accent on purpose:
        // white on that amber is 1.9:1. This is the assertion that catches
        // somebody "fixing" it back to white.
        it('reads on a button', () => {
            expect(contrast(
                channels(vars(), '--button-color-rgb'),
                channels(vars(), '--button-bg-rgb'),
            )).toBeGreaterThanOrEqual(AA)
        })

        it('reads in the sidebar', () => {
            expect(contrast(
                channels(vars(), '--sidebar-text-rgb'),
                channels(vars(), '--sidebar-bg-rgb'),
            )).toBeGreaterThanOrEqual(AA)
        })

        it('reads a link and an error against the canvas', () => {
            const canvas = channels(vars(), '--center-channel-bg-rgb')
            expect(contrast(channels(vars(), '--link-color-rgb'), canvas)).toBeGreaterThanOrEqual(AA)
            expect(contrast(channels(vars(), '--error-text-rgb'), canvas)).toBeGreaterThanOrEqual(AA)
        })

        // Labels are where the old dark theme fell apart: they were alpha over
        // a warm grey and came out as mud. These are opaque now, and every one
        // of the ten has to carry the label text at the 0.8 it is drawn with.
        it.each(labels)('reads label text on %s', (label) => {
            const bg = channels(vars(), label)
            const ink = over(channels(vars(), '--center-channel-color-rgb'), bg, 0.8)
            expect(contrast(ink, bg)).toBeGreaterThanOrEqual(AA)
        })
    })
})
