// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import '@testing-library/jest-dom'
import {render, screen} from '@solidjs/testing-library'

import userEvent from '@testing-library/user-event'

import {wrapDNDIntl} from '../testUtils'

import Menu from '../widgets/menu'

import OptionsIcon from '../widgets/icons/options'

import Dialog from './dialog'

describe('components/dialog', () => {
    beforeEach(vi.clearAllMocks)
    test('should match snapshot', () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <Dialog
                onClose={vi.fn()}
            >
                <div id='test'/>
            </Dialog>,
        ))
        expect(container).toMatchSnapshot()
    })
    test('should return dialog and click onClose button', () => {
        const onCloseMethod = vi.fn()
        render(() => wrapDNDIntl(() =>
            <Dialog
                onClose={onCloseMethod}
            >
                <div id='test'/>
            </Dialog>,
        ))
        const buttonClose = screen.getByRole('button', {name: 'Close dialog'})
        userEvent.click(buttonClose)
        expect(onCloseMethod).toHaveBeenCalledTimes(1)
    })
    test('should return dialog and click to close on wrapper', () => {
        const onCloseMethod = vi.fn()
        const {container} = render(() => wrapDNDIntl(() =>
            <Dialog
                onClose={onCloseMethod}
            >
                <Menu position='left'>
                    <Menu.Text
                        id='test'
                        icon={<OptionsIcon/>}
                        name='Test'
                        onClick={async () => {
                            vi.fn()
                        }}
                    />
                </Menu>
            </Dialog>,
        ))
        const buttonClose = container.querySelector('.wrapper')!
        userEvent.click(buttonClose)
        expect(onCloseMethod).toHaveBeenCalledTimes(1)
    })

    test('should return dialog and click on test button', () => {
        const onTest = vi.fn()
        render(() => wrapDNDIntl(() =>
            <Dialog
                onClose={vi.fn()}
                toolsMenu={<Menu position='left'>
                    <Menu.Text
                        id='test'
                        icon={<OptionsIcon/>}
                        name='Test'
                        onClick={async () => {
                            onTest()
                        }}
                    />
                </Menu>}
            >
                <div id='test'/>
            </Dialog>,
        ))
        const buttonMenu = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonMenu)
        const buttonTest = screen.getByRole('button', {name: 'Test'})
        userEvent.click(buttonTest)
        expect(onTest).toHaveBeenCalledTimes(1)
    })
    test('should return dialog and click on cancel button', () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <Dialog
                onClose={vi.fn()}
                toolsMenu={<Menu position='left'>
                    <Menu.Text
                        id='test'
                        icon={<OptionsIcon/>}
                        name='Test'
                        onClick={async () => {
                            vi.fn()
                        }}
                    />
                </Menu>}
            >
                <div id='test'/>
            </Dialog>,
        ))
        const buttonMenu = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonMenu)
        const buttonTest = screen.getByRole('button', {name: 'Cancel'})
        userEvent.click(buttonTest)
        expect(container).toMatchSnapshot()
    })
})
