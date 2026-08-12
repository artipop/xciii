import {render} from '@solidjs/testing-library'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'

import NotificationBox from './notificationBox'

describe('widgets/NotificationBox', () => {
    beforeEach(() => {
        // Quick fix to disregard console error when unmounting a component
        console.error = vi.fn()
        document.execCommand = vi.fn()
    })

    test('should match snapshot without icon and close', () => {
        const component = () => wrapIntl(() =>
            <NotificationBox
                title='title'
            >
                {'CONTENT'}
            </NotificationBox>,
        )
        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with icon', () => {
        const component = () => wrapIntl(() =>
            <NotificationBox
                title='title'
                icon='ICON'
            >
                {'CONTENT'}
            </NotificationBox>,
        )
        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with close without tooltip', () => {
        const component = () => wrapIntl(() =>
            <NotificationBox
                title='title'
                onClose={() => null}
            >
                {'CONTENT'}
            </NotificationBox>,
        )
        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with close with tooltip', () => {
        const component = () => wrapIntl(() =>
            <NotificationBox
                title='title'
                onClose={() => null}
                closeTooltip='tooltip'
            >
                {'CONTENT'}
            </NotificationBox>,
        )
        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with icon and close with tooltip', () => {
        const component = () => wrapIntl(() =>
            <NotificationBox
                title='title'
                icon='ICON'
                onClose={() => null}
                closeTooltip='tooltip'
            >
                {'CONTENT'}
            </NotificationBox>,
        )
        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })
})
