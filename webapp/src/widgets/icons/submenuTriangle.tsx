import type {JSX} from 'solid-js'

import './submenuTriangle.scss'

export default function SubmenuTriangleIcon(): JSX.Element {
    return (
        <svg
            xmlns='http://www.w3.org/2000/svg'
            class='SubmenuTriangleIcon Icon'
            viewBox='0 0 100 100'
        >
            <polygon points='50,35 75,50 50,65'/>
        </svg>
    )
}
