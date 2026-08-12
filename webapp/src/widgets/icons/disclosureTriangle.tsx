import type {JSX} from 'solid-js'

import './disclosureTriangle.scss'

export default function DisclosureTriangle(): JSX.Element {
    return (
        <svg
            xmlns='http://www.w3.org/2000/svg'
            class='DisclosureTriangleIcon Icon'
            viewBox='0 0 100 100'
        >
            <polygon points='37,35 37,65 63,50'/>
        </svg>
    )
}
