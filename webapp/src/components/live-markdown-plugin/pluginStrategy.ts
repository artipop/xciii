// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// A camelCase style map (fontWeight: 'bold') the styler serializes to inline
// CSS itself — what StyleMap typed before React left this package.
export type StyleMap = {[property: string]: string | number}

// An inline style strategy finds the character ranges within a single line of
// text that should be styled (and, optionally, the delimiter sub-ranges within
// them that should be dimmed). All logic operates on the plain line text plus the
// resolved block type of the line, so it stays editor-framework agnostic.
export interface InlineStrategy {
    style: string
    findStyleRanges: (text: string, blockType: string) => number[][]
    findDelimiterRanges?: (text: string, styleRanges: number[][]) => number[][]
    delimiterStyle?: string
    styles?: StyleMap
    delimiterStyles?: StyleMap
}

// A block strategy classifies a single line of text into a block type (heading
// level, code-block, ...) given the surrounding lines. `mapLineType` receives the
// line text, its index, and the full list of lines so multi-line constructs (like
// fenced code blocks) can be resolved, and returns the block type for that line
// (or the empty string for a plain line).
export interface BlockStrategy {
    type: string
    class: string
    mapLineType: (text: string, lineIndex: number, lines: string[]) => string
}
