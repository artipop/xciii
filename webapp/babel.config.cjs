// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Used by babel-jest only: Vite compiles through vite-plugin-solid, which
// carries its own babel pipeline. Presets apply in reverse order — TypeScript
// is stripped first, Solid compiles the JSX, preset-env then rewrites modules
// for the running Node.
module.exports = {
    presets: [
        ['@babel/preset-env', {targets: {node: 'current'}}],
        'babel-preset-solid',
        '@babel/preset-typescript',
    ],
}
