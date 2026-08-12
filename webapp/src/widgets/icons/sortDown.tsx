import type {JSX} from 'solid-js'

import './sortDown.scss'

export default function SortDownIcon(): JSX.Element {
    return (
        <svg
            xmlns='http://www.w3.org/2000/svg'
            class='SortDownIcon Icon'
            viewBox='0 0 100 100'
        >
            <polyline points='50,20 50,80'/>
            <polyline points='30,60 50,80 70,60'/>
        </svg>
    )
}
