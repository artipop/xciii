// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createEffect, createSignal, onCleanup} from 'solid-js'

import {useIntl, FormattedMessage} from '../intl'

import AlertIcon from '../widgets/icons/alert'

import {useAppSelector, useAppStore} from '../store/hooks'
import {IUser, UserConfigPatch} from '../user'
import {getMe, getCardLimitSnoozeUntil, getCardHiddenWarningSnoozeUntil} from '../store/users'
import {getCurrentBoardHiddenCardsCount, getCardHiddenWarning} from '../store/cards'
import TelemetryClient, {TelemetryActions, TelemetryCategory} from '../telemetry/telemetryClient'
import CheckIcon from '../widgets/icons/check'
import NotificationBox from '../widgets/notificationBox/notificationBox'
import octoClient from '../octoClient'

import './cardLimitNotification.scss'

type Props = {
    showHiddenCardNotification: boolean
    hiddenCardCountNotificationHandler: (show: boolean) => void
}

const snoozeTime = 1000 * 60 * 60 * 24 * 10
const checkSnoozeInterval = 1000 * 60 * 5

const CardLimitNotification = (props: Props) => {
    const intl = useIntl()
    const [time, setTime] = createSignal(Date.now())
    const [showNotifyAdminSuccess, setShowNotifyAdminSuccess] = createSignal<boolean>(false)

    const hiddenCards = useAppSelector<number>(getCurrentBoardHiddenCardsCount)
    const cardHiddenWarning = useAppSelector<boolean>(getCardHiddenWarning)
    const me = useAppSelector<IUser|null>(getMe)
    const snoozedUntil = useAppSelector<number>(getCardLimitSnoozeUntil)
    const snoozedCardHiddenWarningUntil = useAppSelector<number>(getCardHiddenWarningSnoozeUntil)
    const {actions} = useAppStore()

    const onCloseHidden = async () => {
        const user = me()
        if (user) {
            const patch: UserConfigPatch = {
                updatedFields: {
                    cardLimitSnoozeUntil: `${Date.now() + snoozeTime}`,
                },
            }

            const patchedProps = await octoClient.patchUserConfig(user.id, patch)
            if (patchedProps) {
                actions.users.patchProps(patchedProps)
            }
        }
    }

    const onCloseWarning = async () => {
        const user = me()
        if (user) {
            const patch: UserConfigPatch = {
                updatedFields: {
                    cardHiddenWarningSnoozeUntil: `${Date.now() + snoozeTime}`,
                },
            }

            const patchedProps = await octoClient.patchUserConfig(user.id, patch)
            if (patchedProps) {
                actions.users.patchProps(patchedProps)
            }
        }
    }

    // The three-way state the render used to compute inline: whether the box
    // shows, which snooze closing means, and which title it carries.
    const state = () => {
        let show = false
        let onClose = onCloseHidden
        let title = intl.formatMessage(
            {
                id: 'notification-box-card-limit-reached.title',
                defaultMessage: '{cards, plural, one {# card hidden from board} other {# cards hidden from board}}',
            },
            {cards: hiddenCards()},
        )

        if (!show && props.showHiddenCardNotification) {
            show = true
        }

        if (hiddenCards() > 0 && time() > snoozedUntil()) {
            show = true
        }

        if (!show && cardHiddenWarning()) {
            show = time() > snoozedCardHiddenWarningUntil()
            onClose = onCloseWarning
            title = intl.formatMessage(
                {
                    id: 'notification-box-cards-hidden.title',
                    defaultMessage: 'This action has hidden another card',
                },
            )
        }
        return {show, onClose, title}
    }

    createEffect(() => {
        if (!state().show) {
            const interval = setInterval(() => setTime(Date.now()), checkSnoozeInterval)
            onCleanup(() => {
                clearInterval(interval)
            })
        }
    })

    createEffect(() => {
        if (state().show) {
            TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.LimitCardLimitReached, {})
        }
    })

    const handleContactAdminClicked = async () => {
        TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.LimitCardCTAPerformed)

        await octoClient.notifyAdminUpgrade()
        setShowNotifyAdminSuccess(true)
    }

    const onClick = () => {
        (window as any).openPricingModal()({trackingLocation: 'boards > card_limit_notification_upgrade_to_a_paid_plan_click'})
        TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.LimitCardLimitLinkOpen, {})
    }

    const hasPermissionToUpgrade = () => me()?.roles?.split(' ').indexOf('system_admin') !== -1

    const hidHiddenCardNotification = () => {
        props.hiddenCardCountNotificationHandler(false)
    }

    return (
        <Show when={state().show}>
            <NotificationBox
                icon={<AlertIcon/>}
                title={state().title}
                onClose={props.showHiddenCardNotification ? hidHiddenCardNotification : state().onClose}
                closeTooltip={props.showHiddenCardNotification ? '' : intl.formatMessage({
                    id: 'notification-box-card-limit-reached.close-tooltip',
                    defaultMessage: 'Snooze for 10 days',
                })}
            >
                <Show when={hasPermissionToUpgrade()}>
                    <FormattedMessage
                        id='notification-box.card-limit-reached.text'
                        defaultMessage='Card limit reached, to view older cards, {link}'
                        values={{
                            link: (
                                <a
                                    onClick={onClick}
                                >
                                    <FormattedMessage
                                        id='notification-box-card-limit-reached.link'
                                        defaultMessage='Upgrade to a paid plan'
                                    />
                                </a>),
                        }}
                    />
                </Show>
                <Show when={!hasPermissionToUpgrade()}>
                    <FormattedMessage
                        id='notification-box.card-limit-reached.not-admin.text'
                        defaultMessage='To access archived cards, you can {contactLink} to upgrade to a paid plan.'
                        values={{
                            contactLink: (
                                <a
                                    onClick={handleContactAdminClicked}
                                >
                                    <FormattedMessage
                                        id='notification-box-card-limit-reached.contact-link'
                                        defaultMessage='notify your admin'
                                    />
                                </a>),
                        }}
                    />
                </Show>

                <Show when={showNotifyAdminSuccess()}>
                    <NotificationBox
                        class='NotifyAdminSuccessNotify'
                        icon={<CheckIcon/>}
                        title={intl.formatMessage({id: 'ViewLimitDialog.notifyAdmin.Success', defaultMessage: 'Your admin has been notified'})}
                        onClose={() => setShowNotifyAdminSuccess(false)}
                    />
                </Show>
            </NotificationBox>
        </Show>
    )
}

export default CardLimitNotification
