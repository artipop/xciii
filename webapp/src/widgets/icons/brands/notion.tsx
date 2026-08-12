import type {JSX} from 'solid-js'

export default function NotionIcon(): JSX.Element {
    return (
        <svg
            width='24'
            height='24'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='1.7'
            xmlns='http://www.w3.org/2000/svg'
            class='NotionIcon Icon'
        >
            <rect
                x='3'
                y='2.5'
                width='18'
                height='19'
                rx='2.6'
            />
            <path
                d='M8.6 16.4V7.6l6.8 8.8V7.6'
                stroke-linecap='round'
                stroke-linejoin='round'
            />
        </svg>
    )
}
