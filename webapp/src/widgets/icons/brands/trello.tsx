import type {JSX} from 'solid-js'

// The three marks in this folder are drawn rather than fetched: they stand
// beside each other in one list, so they have to share a box, a weight and a
// colour, and a downloaded brand asset shares none of those. Each is the
// service's own silhouette — a board of two lists, a page with an N, a list of
// ticks — at the weight the rest of the app's icons are drawn at.

export default function TrelloIcon(): JSX.Element {
    return (
        <svg
            width='24'
            height='24'
            viewBox='0 0 24 24'
            fill='currentColor'
            xmlns='http://www.w3.org/2000/svg'
            class='TrelloIcon Icon'
        >
            <path
                fill-rule='evenodd'
                clip-rule='evenodd'
                d='M4.5 2h15A2.5 2.5 0 0 1 22 4.5v15a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 19.5v-15A2.5 2.5 0 0 1 4.5 2Zm1.9 3.5a.9.9 0 0 0-.9.9v10.2a.9.9 0 0 0 .9.9h3.6a.9.9 0 0 0 .9-.9V6.4a.9.9 0 0 0-.9-.9H6.4Zm8 0a.9.9 0 0 0-.9.9v5.2a.9.9 0 0 0 .9.9h3.1a.9.9 0 0 0 .9-.9V6.4a.9.9 0 0 0-.9-.9h-3.1Z'
            />
        </svg>
    )
}
