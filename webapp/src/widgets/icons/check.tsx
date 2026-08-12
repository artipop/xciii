import type {JSX} from 'solid-js'

import './check.scss'

export default function CheckIcon(): JSX.Element {
    return (
        <svg
            xmlns='http://www.w3.org/2000/svg'
            class='CheckIcon Icon'
            viewBox='0 0 100 100'
        >
            <polyline points='20,60 40,80 80,40'/>
        </svg>
    )
}
