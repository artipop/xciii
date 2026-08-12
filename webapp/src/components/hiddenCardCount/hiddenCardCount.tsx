import type {JSX} from 'solid-js'

import {useIntl} from '../../intl'

import Button from '../../widgets/buttons/button'

import './hiddenCardCount.scss'

type Props = {
    hiddenCardsCount: number
    showHiddenCardNotification: (show: boolean) => void
}

const HiddenCardCount = (props: Props): JSX.Element => {
    const intl = useIntl()

    const onClickHandler = () => {
        props.showHiddenCardNotification(true)
    }
    return (
        <div
            class='HiddenCardCount'
            onClick={onClickHandler}
        >
            <div class='hidden-card-title'>{intl.formatMessage({id: 'limitedCard.title', defaultMessage: 'Cards hidden'})}</div>
            <Button title='hidden-card-count'>{props.hiddenCardsCount}</Button>
        </div>
    )
}

export default HiddenCardCount
