import DefaultTheme from 'vitepress/theme-without-fonts'

import './custom.css'

// The default theme, repainted. Nothing is replaced: the guide is prose and a
// sidebar, which is exactly what the theme already is — so what it needs from
// us is the product's own palette and typefaces, and those are CSS variables.
//
// `theme-without-fonts` is the same theme minus its own Inter and Punctuation
// webfonts — a megabyte of woff2 nobody would ever see, since custom.css names
// the product's two typefaces instead.
export default DefaultTheme
