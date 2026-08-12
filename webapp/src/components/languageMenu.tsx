// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl} from '../intl'

import Menu from '../widgets/menu'
import MenuWrapper from '../widgets/menuWrapper'
import CheckIcon from '../widgets/icons/check'
import CompassIcon from '../widgets/icons/compassIcon'
import {useAppStore} from '../store/hooks'
import {Constants} from '../constants'

// Beside the theme, and for the same reason: which language the app speaks is
// answered by looking at it, not by opening the settings of the machine.

const LanguageMenu = (): JSX.Element => {
    const intl = useIntl()
    const {actions} = useAppStore()

    const label = intl.formatMessage({id: 'Sidebar.set-language', defaultMessage: 'Set language'})

    return (
        <div class='LanguageMenu'>
            <MenuWrapper
                menu={
                    <Menu position='left'>
                        <For each={Constants.languages}>
                            {(language) => (
                                <Menu.Text
                                    id={`${language.name}-lang`}
                                    name={language.displayName}
                                    onClick={async () => actions.language.storeLanguage(language.code)}
                                    rightIcon={intl.locale.toLowerCase() === language.code ? <CheckIcon/> : null}
                                />
                            )}
                        </For>
                    </Menu>
                }
            >
                <button
                    type='button'
                    class='TopBar__button'
                    aria-label={label}
                    title={label}
                >
                    <CompassIcon icon='translate'/>
                </button>
            </MenuWrapper>
        </div>
    )
}

export default LanguageMenu
