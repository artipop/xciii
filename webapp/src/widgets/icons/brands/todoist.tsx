import type {JSX} from 'solid-js'

export default function TodoistIcon(): JSX.Element {
    return (
        <svg
            width='24'
            height='24'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='1.7'
            xmlns='http://www.w3.org/2000/svg'
            class='TodoistIcon Icon'
        >
            <rect
                x='2.8'
                y='2.5'
                width='18.4'
                height='19'
                rx='4.4'
            />
            {/* Three descending ticks, thinner than the frame around them: at
                the size this is actually drawn, a tick as heavy as the square
                closes the gap to the next one and the three read as one mark. */}
            <path
                d='M7.3 8.6l1.9 1.1 3.5-1.5M7.3 12.4l1.9 1.1 3.5-1.5M7.3 16.2l1.9 1.1 3.5-1.5'
                stroke-width='1.4'
                stroke-linecap='round'
                stroke-linejoin='round'
            />
        </svg>
    )
}
