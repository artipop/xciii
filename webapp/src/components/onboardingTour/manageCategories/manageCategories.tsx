import type {JSX} from 'solid-js'

import {FormattedMessage} from '../../../intl'

import {SidebarTourSteps, TOUR_SIDEBAR} from '..'

import {useMeasurePunchouts} from '../../tutorial_tour_tip/hooks'

import TourTipRenderer from '../tourTipRenderer/tourTipRenderer'

import {ClassForManageCategoriesTourStep} from '../../../components/sidebar/sidebarCategory'

import './manageCategories.scss'

const ManageCategoriesTourStep = (): JSX.Element | null => {
    const title = (
        <FormattedMessage
            id='SidebarTour.ManageCategories.Title'
            defaultMessage='Manage categories'
        />
    )

    const screen = (
        <FormattedMessage
            id='SidebarTour.ManageCategories.Body'
            defaultMessage='Create and manage custom categories. Categories are user-specific, so moving a board to your category won’t impact other members using the same board.'
        />
    )

    const punchout = useMeasurePunchouts([`.${ClassForManageCategoriesTourStep}`])

    return (
        <TourTipRenderer
            requireCard={false}
            category={TOUR_SIDEBAR}
            step={SidebarTourSteps.MANAGE_CATEGORIES}
            screen={screen}
            title={title}
            punchout={punchout()}
            classname='ManageCatergoies'
            telemetryTag='tourPoint4b'
            placement={'right'}
            hideBackdrop={false}
            showForce={true}
        />
    )
}

export default ManageCategoriesTourStep
