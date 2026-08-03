// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'

import {FormattedMessage} from '../../../intl'

import {SidebarTourSteps, TOUR_SIDEBAR} from '..'

import {useMeasurePunchouts} from '../../tutorial_tour_tip/hooks'
import TourTipRenderer from '../tourTipRenderer/tourTipRenderer'

import './searchForBoards.scss'

const SearchForBoardsTourStep = (): JSX.Element | null => {
    const title = (
        <FormattedMessage
            id='SidebarTour.SearchForBoards.Title'
            defaultMessage='Search for boards'
        />
    )

    const screen = (
        <FormattedMessage
            id='SidebarTour.SearchForBoards.Body'
            defaultMessage='Open the board switcher (Cmd/Ctrl + K) to quickly search and add boards to your sidebar.'
        />
    )

    const punchout = useMeasurePunchouts(['.BoardsSwitcher'], [])

    return (
        <TourTipRenderer
            requireCard={false}
            category={TOUR_SIDEBAR}
            step={SidebarTourSteps.SEARCH_FOR_BOARDS}
            screen={screen}
            title={title}
            punchout={punchout}
            classname='SearchForBoards'
            telemetryTag='tourPoint4d'
            placement={'right'}
            hideBackdrop={false}
            showForce={true}
        />
    )
}

export default SearchForBoardsTourStep
